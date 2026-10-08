// 888travel (RoamRadar) sync worker (Cloudflare)
// One hub. Your app is the only UI. Everything else is headless:
//   - Google Calendar    reads events you already drop in (Booking, Airbnb...) as trip segments, writes one clean event per trip
//   - Gmail + Claude      parses confirmation emails (drivers, transfers) into segments
//   - TripIt API          OPTIONAL drop-in replacement for ingestion (see note in ingestSegments)
//
// Storage: one KV namespace bound as TRIPS, single JSON doc under key "store".
// Secrets (wrangler secret put NAME) - all optional, everything connects in-app too:
//   ANTHROPIC_API_KEY
//   GOOGLE_CLIENT_ID  GOOGLE_CLIENT_SECRET  GOOGLE_REFRESH_TOKEN  GOOGLE_CALENDAR_ID(optional, default "primary")
//   CALENDLY_TOKEN (optional)

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return cors(new Response(null, { status: 204 }));

    // --- Auto-migrate legacy single-user data on first run
    await ensureMultiTenantMigration(env);

    // --- Authentication status & configuration
    if (url.pathname === "/auth/status" && request.method === "GET") {
      const authSet = !!(await env.TRIPS.get("auth"));
      const authEmail = (await env.TRIPS.get("auth_email")) || null;
      const resendKey = await getResendKey(env);
      const places = await getGooglePlacesConfig(env);
      const sysConfig = await getSystemConfig(env);
      const session = await resolveSession(request, env);
      return cors(json({
        set: authSet,
        email: authEmail ? maskEmail(authEmail) : null,
        fullEmail: authEmail,
        resendConfigured: !!resendKey,
        googlePlacesConfigured: places.configured,
        allowRegistration: sysConfig.allow_registration,
        authenticated: !!session,
        currentUser: session ? { uid: session.uid, email: session.email, role: session.role } : null
      }));
    }

    // --- Multi-Tenant Login (Email + Password)
    if (url.pathname === "/auth/login" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const pw = (body && body.password) || "";
      const email = ((body && body.email) || "").trim().toLowerCase();
      if (!pw || !email) return cors(json({ error: "email and password required" }, 400));
      const hash = await sha256(pw);
      const storedHash = await env.TRIPS.get("auth");

      // First-time setup on fresh instance
      if (!storedHash) {
        await env.TRIPS.put("auth", hash);
        await env.TRIPS.put("auth_email", email);
        const adminUser = {
          uid: "usr_admin",
          email,
          passwordHash: hash,
          role: "admin",
          status: "active",
          createdAt: Date.now()
        };
        await saveUser(env, adminUser);
        await saveSystemConfig(env, {
          allow_registration: false,
          admin_email: email,
          shared_ai_pool: false,
          version: 2
        });
        const token = await createSession(env, adminUser);
        ctx.waitUntil(pingInstallCount(env));
        return okLogin(token, adminUser);
      }

      // Check registered users table
      let user = await getUserByEmail(env, email);
      if (!user) {
        // Fallback check legacy admin
        const storedEmail = ((await env.TRIPS.get("auth_email")) || "").trim().toLowerCase();
        if (storedHash === hash && (!storedEmail || storedEmail === email)) {
          user = {
            uid: "usr_admin",
            email,
            passwordHash: hash,
            role: "admin",
            status: "active",
            createdAt: Date.now()
          };
          await saveUser(env, user);
        }
      }

      if (!user) return cors(json({ error: "wrong email or password" }, 401));
      if (user.passwordHash !== hash) return cors(json({ error: "wrong email or password" }, 401));
      if (user.status === "disabled") return cors(json({ error: "account is suspended" }, 403));

      const token = await createSession(env, user);
      return okLogin(token, user);
    }

    // --- Multi-Tenant Registration Gateway
    if (url.pathname === "/auth/register" && request.method === "POST") {
      const cfg = await getSystemConfig(env);
      if (!cfg.allow_registration) {
        return cors(json({ error: "註冊功能目前已關閉，僅限管理員或既有用戶登入 / Registration is currently closed" }, 403));
      }

      const body = await request.json().catch(() => ({}));
      const email = ((body && body.email) || "").trim().toLowerCase();
      const pw = (body && body.password) || "";
      const turnstileToken = (body && body.turnstileToken) || "";

      if (!email || !email.includes("@")) {
        return cors(json({ error: "請輸入有效的電子信箱 / Valid email required" }, 400));
      }
      if (!pw || pw.length < 6) {
        return cors(json({ error: "密碼長度至少需 6 個字元 / Password must be at least 6 characters" }, 400));
      }

      if (env.TURNSTILE_SECRET_KEY) {
        const clientIp = request.headers.get("CF-Connecting-IP") || "";
        const verified = await verifyTurnstile(env, turnstileToken, clientIp);
        if (!verified) {
          return cors(json({ error: "人機驗證失敗，請重試 / Bot verification failed" }, 403));
        }
      }

      const existingUser = await getUserByEmail(env, email);
      if (existingUser) {
        return cors(json({ error: "此信箱已註冊，請直接登入 / Account already exists, please sign in" }, 409));
      }

      const uid = "usr_" + randHex(8);
      const hash = await sha256(pw);
      const newUser = {
        uid,
        email,
        passwordHash: hash,
        role: "user",
        status: "active",
        createdAt: Date.now()
      };
      await saveUser(env, newUser);
      await saveTenantStore(env, uid, { trips: {}, seenEmails: {}, deletedSegs: {} });

      const token = await createSession(env, newUser);
      return okLogin(token, newUser, 201);
    }

    // --- OTP Verification Code Dispatch (Login & Registration)
    if (url.pathname === "/auth/otp/send" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const email = ((body && body.email) || "").trim().toLowerCase();
      const purpose = (body && body.purpose) || "login";
      if (!email || !email.includes("@")) return cors(json({ error: "請輸入有效的電子信箱 / Valid email required" }, 400));

      const cfg = await getSystemConfig(env);
      const existingUser = await getUserByEmail(env, email);
      const storedAuth = await env.TRIPS.get("auth");
      const storedEmail = ((await env.TRIPS.get("auth_email")) || "").trim().toLowerCase();
      const isAdmin = storedAuth && storedEmail && storedEmail === email;

      if (purpose === "register") {
        if (!cfg.allow_registration) {
          return cors(json({ error: "註冊功能目前已關閉 / Registration is currently closed" }, 403));
        }
        if (existingUser || isAdmin) {
          return cors(json({ error: "此信箱已註冊，請直接登入 / Account already exists" }, 409));
        }
      } else {
        if (!existingUser && !isAdmin && storedAuth) {
          return cors(json({ error: "此信箱尚未註冊，請先註冊帳號 / Account not recognized" }, 403));
        }
      }

      const resendKey = await getResendKey(env);
      if (!resendKey) {
        return cors(json({ error: "尚未設定 Resend API 金鑰，請先使用密碼登入並於設定頁面配置 Resend / Resend API key not configured" }, 400));
      }

      // Rate Limit 1: 60-second cooldown
      const cooldown = await env.TRIPS.get("otp_cd:" + email);
      if (cooldown) {
        return cors(json({ error: "請求過於頻繁，請等待 60 秒後再重新發送 / Please wait 60s before requesting another code" }, 429));
      }

      // Rate Limit 2: Hourly quota (5 per email per hour)
      const hourlyKey = "otp_rate:" + email;
      const hourlyRaw = await env.TRIPS.get(hourlyKey);
      const hourlyCount = hourlyRaw ? parseInt(hourlyRaw, 10) : 0;
      if (hourlyCount >= 5) {
        return cors(json({ error: "驗證碼發送次數已達每小時上限 (5次)，請稍後再試 / Hourly limit exceeded" }, 429));
      }
      await env.TRIPS.put(hourlyKey, String(hourlyCount + 1), { expirationTtl: 3600 });

      // Generate 6-digit numeric OTP code
      const code = Math.floor(100000 + Math.random() * 900000).toString();
      await env.TRIPS.put("otp:" + email, JSON.stringify({ code, attempts: 0, createdAt: Date.now(), purpose }), { expirationTtl: 600 });
      await env.TRIPS.put("otp_cd:" + email, "1", { expirationTtl: 60 });

      try {
        await sendEmailViaResend(env, {
          to: email,
          subject: `【888漫步旅遊 / 888travel】您的驗證碼：${code}`,
          text: `您好！\n\n您的 888漫步旅遊 (888travel) 驗證碼為：\n\n${code}\n\n驗證碼有效期為 10 分鐘。如果您並未要求此驗證碼，請忽略此郵件。`,
          html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'PingFang TC','Noto Sans TC',sans-serif;max-width:480px;margin:0 auto;background:#ECE7DC;padding:36px 24px;border-radius:18px;">
            <div style="background:#FFFFFF;border-radius:14px;padding:32px 28px;box-shadow:0 12px 36px rgba(22,19,12,0.08);text-align:center;">
              <div style="font-size:20px;font-weight:800;color:#16130C;margin-bottom:8px;">888漫步旅遊 · 888travel</div>
              <div style="font-size:14px;color:#756D5E;margin-bottom:24px;">一次性登入與驗證安全碼 (One-Time Password)</div>
              <div style="background:#F6F2E9;border:1px solid rgba(22,19,12,0.1);border-radius:10px;padding:18px;margin:18px 0;">
                <div style="font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,monospace;font-size:36px;font-weight:800;letter-spacing:8px;color:#FF5A35;line-height:1;">${code}</div>
              </div>
              <div style="font-size:13px;color:#756D5E;line-height:1.6;margin-top:16px;">
                此驗證碼於 <b>10 分鐘內有效</b>。<br>
                若您並未主動索取此驗證碼，請忽略此郵件。
              </div>
            </div>
          </div>`
        });
        return cors(json({ ok: true, message: "驗證碼已寄出至您的信箱，10 分鐘內有效。" }));
      } catch (err) {
        return cors(json({ error: "寄送驗證碼失敗：" + (err && err.message ? err.message : String(err)) }, 500));
      }
    }

    // --- OTP Verify & Session Minting
    if (url.pathname === "/auth/otp/verify" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const email = ((body && body.email) || "").trim().toLowerCase();
      const code = ((body && body.code) || "").trim();
      const setPassword = (body && body.password) || "";
      if (!email || !code) return cors(json({ error: "信箱與驗證碼皆為必填 / Email and code required" }, 400));

      const otpRaw = await env.TRIPS.get("otp:" + email);
      if (!otpRaw) return cors(json({ error: "驗證碼不存在或已過期，請重新索取 / Invalid or expired code" }, 400));

      let otpData;
      try { otpData = JSON.parse(otpRaw); } catch(e) { otpData = null; }
      if (!otpData || !otpData.code) return cors(json({ error: "驗證碼格式異常，請重新索取 / Invalid code state" }, 400));

      if ((otpData.attempts || 0) >= 5) {
        await env.TRIPS.delete("otp:" + email);
        return cors(json({ error: "驗證碼嘗試錯誤次數過多，已失效，請重新索取 / Too many attempts" }, 400));
      }

      if (otpData.code !== code) {
        otpData.attempts = (otpData.attempts || 0) + 1;
        await env.TRIPS.put("otp:" + email, JSON.stringify(otpData), { expirationTtl: 600 });
        return cors(json({ error: "驗證碼不正確，請重新檢查 / Incorrect verification code" }, 401));
      }

      // Verification succeeded: remove OTP
      await env.TRIPS.delete("otp:" + email);

      let storedHash = await env.TRIPS.get("auth");
      const storedEmail = ((await env.TRIPS.get("auth_email")) || "").trim().toLowerCase();

      // First-time setup via OTP on fresh instance
      if (!storedHash) {
        storedHash = setPassword ? await sha256(setPassword) : await sha256(crypto.randomUUID() + "-" + Date.now());
        await env.TRIPS.put("auth", storedHash);
        await env.TRIPS.put("auth_email", email);
        const adminUser = {
          uid: "usr_admin",
          email,
          passwordHash: storedHash,
          role: "admin",
          status: "active",
          createdAt: Date.now()
        };
        await saveUser(env, adminUser);
        await saveSystemConfig(env, {
          allow_registration: false,
          admin_email: email,
          shared_ai_pool: false,
          version: 2
        });
        const token = await createSession(env, adminUser);
        ctx.waitUntil(pingInstallCount(env));
        return okLogin(token, adminUser);
      }

      let user = await getUserByEmail(env, email);
      if (!user) {
        if (storedEmail && storedEmail === email) {
          user = {
            uid: "usr_admin",
            email,
            passwordHash: storedHash,
            role: "admin",
            status: "active",
            createdAt: Date.now()
          };
          await saveUser(env, user);
        } else if (otpData.purpose === "register") {
          const cfg = await getSystemConfig(env);
          if (!cfg.allow_registration) {
            return cors(json({ error: "註冊功能目前已關閉 / Registration closed" }, 403));
          }
          const hash = setPassword ? await sha256(setPassword) : "";
          const uid = "usr_" + randHex(8);
          user = {
            uid,
            email,
            passwordHash: hash,
            role: "user",
            status: "active",
            createdAt: Date.now()
          };
          await saveUser(env, user);
          await saveTenantStore(env, uid, { trips: {}, seenEmails: {}, deletedSegs: {} });
        } else {
          return cors(json({ error: "用戶不存在，請先註冊帳號 / Account not found" }, 404));
        }
      }

      const token = await createSession(env, user);
      return okLogin(token, user);
    }

    // --- Log out: revoke session & expire cookie
    if (url.pathname === "/auth/logout" && request.method === "POST") {
      const header = request.headers.get("X-Auth") || "";
      const m = (request.headers.get("Cookie") || "").match(/(?:^|;\s*)tk=([^;]+)/);
      const token = header || (m ? m[1] : "");
      if (token && token.startsWith("s_")) {
        await env.TRIPS.delete("session:" + token);
      }
      const r = cors(json({ ok: true }));
      r.headers.append("Set-Cookie", `tk=; Max-Age=0; Path=/; Secure; HttpOnly; SameSite=Lax`);
      return r;
    }

    // --- Admin: System Configuration (Registration Toggle & Shared AI Pool)
    if (url.pathname === "/admin/config" && request.method === "POST") {
      const session = await resolveSession(request, env);
      if (!session || session.role !== "admin") {
        return cors(json({ error: "需要管理員權限 / Admin privilege required" }, 403));
      }
      const body = await request.json().catch(() => ({}));
      const cfg = await getSystemConfig(env);
      if (typeof body.allow_registration === "boolean") {
        cfg.allow_registration = body.allow_registration;
      }
      if (typeof body.shared_ai_pool === "boolean") {
        cfg.shared_ai_pool = body.shared_ai_pool;
      }
      await saveSystemConfig(env, cfg);
      return cors(json({ ok: true, config: cfg }));
    }
    if (url.pathname === "/admin/config" && request.method === "GET") {
      const session = await resolveSession(request, env);
      if (!session || session.role !== "admin") {
        return cors(json({ error: "需要管理員權限 / Admin privilege required" }, 403));
      }
      const cfg = await getSystemConfig(env);
      return cors(json({ ok: true, config: cfg }));
    }

    // --- Admin: List Registered Users
    if (url.pathname === "/admin/users" && request.method === "GET") {
      const session = await resolveSession(request, env);
      if (!session || session.role !== "admin") {
        return cors(json({ error: "需要管理員權限 / Admin privilege required" }, 403));
      }
      const userList = await listAllUsers(env);
      return cors(json({ ok: true, users: userList }));
    }
    // --- Google consent flow. These two are plain browser NAVIGATIONS, not app
    // fetches, so they cannot carry the X-Auth header and may lack the session
    // cookie (e.g. a login from before cookies existed, or a PWA's separate
    // cookie jar). /google/connect therefore accepts the session token as ?t=
    // (the app puts it there), and /google/callback is authorised by its
    // single-use state code instead - Google's redirect carries no credentials.
    if (url.pathname === "/google/connect" && request.method === "GET") {
      const stored = await env.TRIPS.get("auth");
      const t = url.searchParams.get("t") || "";
      const cm = (request.headers.get("Cookie") || "").match(/(?:^|;\s*)tk=([^;]+)/);
      const token = t || (cm ? cm[1] : "");

      let session = await resolveSession(request, env);
      if (!session && token && token.startsWith("s_")) {
        const raw = await env.TRIPS.get("session:" + token);
        if (raw) {
          try { session = JSON.parse(raw); } catch(e) {}
        }
      }

      const isLegacyAuth = stored && (token === stored);
      if (!session && !isLegacyAuth)
        return new Response("Sign in to the app first, then hit Connect Google again.", { status: 401 });
      const c = await googleClient(env);
      if (!c) return new Response("Save your Google client ID and secret in Settings first.", { status: 400 });
      const state = uid() + uid();
      await env.TRIPS.put("g_state", state, { expirationTtl: 600 });
      const p = new URLSearchParams({
        client_id: c.id, redirect_uri: url.origin + "/google/callback", response_type: "code",
        scope: "https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/gmail.readonly",
        access_type: "offline", prompt: "consent", state,
      });
      return Response.redirect("https://accounts.google.com/o/oauth2/v2/auth?" + p, 302);
    }
    if (url.pathname === "/google/callback" && request.method === "GET") {
      const c = await googleClient(env);
      const state = await env.TRIPS.get("g_state");
      if (!c || !state || url.searchParams.get("state") !== state)
        return new Response("This connection attempt expired - go back to Settings and hit Connect Google again.", { status: 400 });
      await env.TRIPS.delete("g_state");
      const res = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: c.id, client_secret: c.secret, code: url.searchParams.get("code") || "",
          grant_type: "authorization_code", redirect_uri: url.origin + "/google/callback",
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!d.refresh_token)
        return new Response("Google did not hand back a refresh token (" + (d.error_description || d.error || "cancelled") + "). Go back to Settings and try Connect Google again.", { status: 400 });
      await env.TRIPS.put("g_refresh", d.refresh_token);
      return new Response('<meta charset="utf-8"><body style="font-family:sans-serif;padding:40px;max-width:520px"><h2>Google connected &#10003;</h2><p>Calendar events and Gmail confirmations will flow into your trips on the next sync.</p><p><a href="/app">Back to the app</a></p>',
        { headers: { "Content-Type": "text/html" } });
    }
    // --- Companion view: a read-only page for ONE trip, authorised by its own
    // unguessable token (128-bit hex minted by POST /trips/share). PUBLIC by
    // design - you send this link to whoever travels with you. Revoking the
    // token (or deleting the trip) kills the page.
    if (url.pathname.startsWith("/t/") && request.method === "GET") {
      const tok = url.pathname.slice(3);
      if (!/^[a-f0-9]{32}$/.test(tok)) return new Response("Not found", { status: 404 });
      const shareRaw = await env.TRIPS.get("share:" + tok);
      let targetUid = "usr_admin";
      let targetTripId = null;
      if (shareRaw) {
        try {
          const info = JSON.parse(shareRaw);
          targetUid = info.uid;
          targetTripId = info.tripId;
        } catch(e) {}
      }
      const store = await loadStore(env, targetUid);
      const t = targetTripId ? store.trips[targetTripId] : Object.values(store.trips).find((x) => x.shareToken === tok);
      if (!t) return new Response("This trip link is no longer active.", { status: 404 });
      return new Response(shareTripHtml(t), { headers: { "Content-Type": "text/html; charset=utf-8" } });
    }
    // --- Calendar feed: one private ICS URL any calendar app can subscribe to
    // (Apple/Outlook/Google "from URL") - all trips with their plans, no OAuth
    // needed. Authorised by the feed token because calendar apps cannot send
    // headers; the token is minted by POST /ics/token.
    if (url.pathname === "/cal.ics" && request.method === "GET") {
      const tok = url.searchParams.get("t") || "";
      let targetUid = await env.TRIPS.get("ics_uid:" + tok);
      if (!targetUid) {
        const want = (await env.TRIPS.get("ics_token")) || "";
        if (want && tok === want) targetUid = "usr_admin";
      }
      if (!targetUid) return new Response("unauthorized", { status: 401 });
      const store = await loadStore(env, targetUid);
      return new Response(buildIcs(store), { headers: { "Content-Type": "text/calendar; charset=utf-8" } });
    }

    // --- Machine-readable Discovery (llms.txt, llms-full.txt, SKILL.md) ---
    if ((url.pathname === "/llms.txt" || url.pathname === "/api/llms.txt") && (request.method === "GET" || request.method === "HEAD")) {
      const body = LLMS_TXT.replace(/https:\/\/travel\.david888\.com/g, url.origin);
      return cors(new Response(request.method === "HEAD" ? null : body, {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "public, max-age=0, must-revalidate"
        }
      }));
    }
    if (url.pathname === "/llms-full.txt" && (request.method === "GET" || request.method === "HEAD")) {
      const body = LLMS_FULL_TXT.replace(/https:\/\/travel\.david888\.com/g, url.origin);
      return cors(new Response(request.method === "HEAD" ? null : body, {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "public, max-age=0, must-revalidate"
        }
      }));
    }
    if (url.pathname === "/skill.md" && (request.method === "GET" || request.method === "HEAD")) {
      const body = SKILL_MD.replace(/https:\/\/travel\.david888\.com/g, url.origin);
      const isMd = (request.headers.get("Accept") || "").includes("text/markdown");
      return cors(new Response(request.method === "HEAD" ? null : body, {
        headers: {
          "Content-Type": (isMd ? "text/markdown" : "text/plain") + "; charset=utf-8",
          "Cache-Control": "public, max-age=0, must-revalidate"
        }
      }));
    }

    // --- Agent RESTful API v1 (/api/v1/*) ---
    if (url.pathname.startsWith("/api/v1/")) {
      const agentBlocked = await agentAuthGuard(request, env);
      if (agentBlocked) return cors(agentBlocked);
      const currentUid = (request.session && request.session.uid) || "usr_admin";

      // GET /api/v1/trips - List all trips
      if (url.pathname === "/api/v1/trips" && request.method === "GET") {
        const store = await loadStore(env, currentUid);
        const trips = Object.values(store.trips)
          .sort((a, b) => ((a.start || "") < (b.start || "") ? -1 : 1))
          .map(t => ({
            id: t.id,
            from: t.from || "",
            to: t.to || "",
            start: t.start || "",
            end: t.end || "",
            label: t.label || "",
            notes: t.notes || "",
            timezone: t.timezone || "",
            photo: t.photo || "",
            updatedAt: t.updatedAt || null,
            segmentCount: (t.segments || []).length,
            segments: t.segments || []
          }));
        return cors(json({ ok: true, count: trips.length, trips }));
      }

      // POST /api/v1/trips - Create new trip
      if (url.pathname === "/api/v1/trips" && request.method === "POST") {
        const body = await request.json().catch(() => null);
        if (!body || typeof body !== "object") return cors(json({ error: "Invalid JSON request body" }, 400));
        if (!body.to || !body.start || !body.end) {
          return cors(json({ error: "Missing required trip fields: 'to', 'start', and 'end' are required" }, 400));
        }
        const store = await loadStore(env, currentUid);
        const id = (body.id ? String(body.id).trim() : "") || uid();
        const start = norm(body.start);
        const end = norm(body.end);

        const initialSegs = (Array.isArray(body.segments) ? body.segments : []).map(s => {
          const sid = s.sid || uid();
          const type = ["flight", "hotel", "restaurant", "car", "ride", "rail", "other"].includes(s.type) ? s.type : guessType(s.name || "");
          const segObj = {
            sid,
            type,
            name: String(s.name || "Plan").trim(),
            address: s.address ? String(s.address).trim() : "",
            note: s.note ? String(s.note).trim() : "",
            start: s.start ? String(s.start).slice(0, 16) : "",
            end: s.end ? String(s.end).slice(0, 16) : "",
            conf: s.conf ? String(s.conf).trim() : ("man:" + uid()),
            source: "manual",
            rating: s.rating !== undefined ? Number(s.rating) : null,
            userRatingsTotal: s.userRatingsTotal !== undefined ? Number(s.userRatingsTotal) : null,
            openNow: s.openNow !== undefined ? Boolean(s.openNow) : null,
            mapsUrl: s.mapsUrl ? String(s.mapsUrl) : "",
            placeId: s.placeId ? String(s.placeId) : ""
          };
          if (s.fallback && s.fallback.name) {
            segObj.fallback = {
              name: String(s.fallback.name).trim(),
              address: s.fallback.address ? String(s.fallback.address).trim() : "",
              note: s.fallback.note ? String(s.fallback.note).trim() : "",
              mapsUrl: s.fallback.mapsUrl ? String(s.fallback.mapsUrl) : "",
              rating: s.fallback.rating !== undefined ? Number(s.fallback.rating) : null,
              userRatingsTotal: s.fallback.userRatingsTotal !== undefined ? Number(s.fallback.userRatingsTotal) : null,
              openNow: s.fallback.openNow !== undefined ? Boolean(s.fallback.openNow) : null,
              placeId: s.fallback.placeId ? String(s.fallback.placeId) : ""
            };
          }
          return segObj;
        }).sort(segCmp);

        store.trips[id] = {
          id,
          from: (body.from ? String(body.from).trim() : "").toUpperCase(),
          to: String(body.to).trim().toUpperCase(),
          start,
          end,
          label: body.label ? String(body.label).trim() : "",
          notes: body.notes ? String(body.notes).trim() : "",
          timezone: body.timezone ? String(body.timezone).trim() : "",
          photo: body.photo ? String(body.photo).trim() : "",
          segments: initialSegs,
          updatedAt: Date.now()
        };
        await saveStore(env, store, currentUid);
        return cors(json({ ok: true, trip: store.trips[id] }, 201));
      }

      // POST /api/v1/trips/:id/segments - Append single or batch segments
      const segBatchMatch = url.pathname.match(/^\/api\/v1\/trips\/([a-zA-Z0-9_-]+)\/segments\/?$/);
      if (segBatchMatch && request.method === "POST") {
        const tripId = segBatchMatch[1];
        const store = await loadStore(env, currentUid);
        const t = store.trips[tripId];
        if (!t) return cors(json({ error: "Trip not found" }, 404));

        const body = await request.json().catch(() => null);
        if (!body) return cors(json({ error: "Invalid JSON body" }, 400));
        const isArray = Array.isArray(body);
        const incoming = isArray ? body : (typeof body === "object" ? [body] : []);
        if (!incoming.length) return cors(json({ error: "At least one segment required" }, 400));

        t.segments = t.segments || [];
        const added = [];
        for (const item of incoming) {
          if (!item || !item.name) continue;
          const sid = item.sid || uid();
          const type = ["flight", "hotel", "restaurant", "car", "ride", "rail", "other"].includes(item.type) ? item.type : guessType(item.name);
          const segObj = {
            sid,
            type,
            name: String(item.name).trim(),
            address: item.address ? String(item.address).trim() : "",
            note: item.note ? String(item.note).trim() : "",
            start: item.start ? String(item.start).slice(0, 16) : "",
            end: item.end ? String(item.end).slice(0, 16) : "",
            conf: item.conf ? String(item.conf).trim() : ("man:" + uid()),
            source: "manual", // invariant rule: strictly manual!
            rating: item.rating !== undefined ? Number(item.rating) : null,
            userRatingsTotal: item.userRatingsTotal !== undefined ? Number(item.userRatingsTotal) : null,
            openNow: item.openNow !== undefined ? Boolean(item.openNow) : null,
            mapsUrl: item.mapsUrl ? String(item.mapsUrl) : "",
            placeId: item.placeId ? String(item.placeId) : ""
          };
          if (item.fallback && item.fallback.name) {
            segObj.fallback = {
              name: String(item.fallback.name).trim(),
              address: item.fallback.address ? String(item.fallback.address).trim() : "",
              note: item.fallback.note ? String(item.fallback.note).trim() : "",
              mapsUrl: item.fallback.mapsUrl ? String(item.fallback.mapsUrl) : "",
              rating: item.fallback.rating !== undefined ? Number(item.fallback.rating) : null,
              userRatingsTotal: item.fallback.userRatingsTotal !== undefined ? Number(item.fallback.userRatingsTotal) : null,
              openNow: item.fallback.openNow !== undefined ? Boolean(item.fallback.openNow) : null,
              placeId: item.fallback.placeId ? String(item.fallback.placeId) : ""
            };
          }
          t.segments.push(segObj);
          added.push(segObj);
        }
        t.segments.sort(segCmp);
        t.updatedAt = Date.now();
        await saveStore(env, store, currentUid);
        return cors(json({ ok: true, count: added.length, segments: isArray ? added : added[0] }, 201));
      }

      // PUT /api/v1/trips/:id/segments/:sid - Update existing segment
      const segItemMatch = url.pathname.match(/^\/api\/v1\/trips\/([a-zA-Z0-9_-]+)\/segments\/([a-zA-Z0-9_-]+)\/?$/);
      if (segItemMatch && request.method === "PUT") {
        const tripId = segItemMatch[1], sid = segItemMatch[2];
        const store = await loadStore(env, currentUid);
        const t = store.trips[tripId];
        if (!t) return cors(json({ error: "Trip not found" }, 404));
        const s = (t.segments || []).find(x => x.sid === sid);
        if (!s) return cors(json({ error: "Segment not found" }, 404));

        const body = await request.json().catch(() => ({}));
        if (body.type) s.type = ["flight", "hotel", "restaurant", "car", "ride", "rail", "other"].includes(body.type) ? body.type : s.type;
        if (body.name !== undefined) s.name = String(body.name).trim();
        if (body.address !== undefined) s.address = String(body.address).trim();
        if (body.note !== undefined) s.note = String(body.note).trim();
        if (body.start !== undefined) s.start = String(body.start).slice(0, 16);
        if (body.end !== undefined) s.end = String(body.end).slice(0, 16);
        if (body.conf !== undefined) s.conf = String(body.conf).trim();
        if (body.rating !== undefined) s.rating = body.rating;
        if (body.userRatingsTotal !== undefined) s.userRatingsTotal = body.userRatingsTotal;
        if (body.openNow !== undefined) s.openNow = body.openNow;
        if (body.mapsUrl !== undefined) s.mapsUrl = body.mapsUrl;
        if (body.placeId !== undefined) s.placeId = body.placeId;
        s.source = "manual";

        if (body.fallback === null) {
          delete s.fallback;
        } else if (body.fallback && typeof body.fallback === "object" && body.fallback.name) {
          s.fallback = {
            name: String(body.fallback.name).trim(),
            address: body.fallback.address ? String(body.fallback.address).trim() : "",
            note: body.fallback.note ? String(body.fallback.note).trim() : "",
            mapsUrl: body.fallback.mapsUrl ? String(body.fallback.mapsUrl) : "",
            rating: body.fallback.rating !== undefined ? body.fallback.rating : null,
            userRatingsTotal: body.fallback.userRatingsTotal !== undefined ? body.fallback.userRatingsTotal : null,
            openNow: body.fallback.openNow !== undefined ? body.fallback.openNow : null,
            placeId: body.fallback.placeId ? String(body.fallback.placeId) : ""
          };
        }

        t.segments.sort(segCmp);
        t.updatedAt = Date.now();
        await saveStore(env, store, currentUid);
        return cors(json({ ok: true, segment: s }));
      }

      // DELETE /api/v1/trips/:id/segments/:sid - Delete segment with tombstoning
      if (segItemMatch && request.method === "DELETE") {
        const tripId = segItemMatch[1], sid = segItemMatch[2];
        const store = await loadStore(env, currentUid);
        const t = store.trips[tripId];
        if (!t) return cors(json({ error: "Trip not found" }, 404));
        const s = (t.segments || []).find(x => x.sid === sid);
        if (!s) return cors(json({ error: "Segment not found" }, 404));

        store.deletedSegs = store.deletedSegs || {};
        if (s.conf) store.deletedSegs[s.conf] = Date.now();
        t.segments = (t.segments || []).filter(x => x.sid !== sid);
        t.updatedAt = Date.now();
        await saveStore(env, store, currentUid);
        return cors(json({ ok: true, deleted: true, sid }));
      }

      // Single trip routes: /api/v1/trips/:id
      const tripMatch = url.pathname.match(/^\/api\/v1\/trips\/([a-zA-Z0-9_-]+)\/?$/);
      if (tripMatch) {
        const tripId = tripMatch[1];
        const store = await loadStore(env, currentUid);
        const t = store.trips[tripId];

        // GET /api/v1/trips/:id
        if (request.method === "GET") {
          if (!t) return cors(json({ error: "Trip not found" }, 404));
          return cors(json({ ok: true, trip: t }));
        }

        // PUT /api/v1/trips/:id
        if (request.method === "PUT") {
          if (!t) return cors(json({ error: "Trip not found" }, 404));
          const body = await request.json().catch(() => ({}));
          if (body.from !== undefined) t.from = String(body.from).trim().toUpperCase();
          if (body.to !== undefined) t.to = String(body.to).trim().toUpperCase();
          if (body.start !== undefined) t.start = norm(body.start);
          if (body.end !== undefined) t.end = norm(body.end);
          if (body.label !== undefined) t.label = String(body.label).trim();
          if (body.notes !== undefined) t.notes = String(body.notes).trim();
          if (body.timezone !== undefined) t.timezone = String(body.timezone).trim();
          if (body.photo !== undefined) t.photo = String(body.photo).trim();
          t.updatedAt = Date.now();
          await saveStore(env, store, currentUid);
          return cors(json({ ok: true, trip: t }));
        }

        // DELETE /api/v1/trips/:id
        if (request.method === "DELETE") {
          if (!t) return cors(json({ error: "Trip not found" }, 404));
          delete store.trips[tripId];
          await saveStore(env, store, currentUid);
          return cors(json({ ok: true, deleted: true, id: tripId }));
        }
      }

      // GET /api/v1/status - Instance health, versions, and integrations
      if (url.pathname === "/api/v1/status" && request.method === "GET") {
        const store = await loadStore(env, currentUid);
        const llm = await getLLMConfig(env, currentUid);
        const places = await getGooglePlacesConfig(env);
        const gClient = await googleClient(env);
        const gRefresh = env.GOOGLE_REFRESH_TOKEN || (await env.TRIPS.get("g_refresh")) || "";
        const resend = await getResendConfig(env);
        const trips = Object.values(store.trips);
        const now = new Date().toISOString().slice(0, 10);
        const upcoming = trips.filter(t => (t.end || t.start) >= now).length;
        return cors(json({
          ok: true,
          service: "888travel",
          version: "2.6.7",
          instance: url.origin,
          serverTime: new Date().toISOString(),
          totalTrips: trips.length,
          upcomingTrips: upcoming,
          totalWishes: (store.wishes || []).length,
          integrations: {
            llm: { configured: !!llm.apiKey, provider: llm.provider, model: llm.model, fallbackModel: llm.fallbackModel || null },
            googlePlaces: { configured: places.configured },
            googleCalendar: { configured: !!(gClient && gRefresh) },
            resend: { configured: !!resend.apiKey }
          }
        }));
      }

      // POST /api/v1/trips/:id/segments/:sid/swap-fallback - 1-Click Contingency Swap
      const swapMatch = url.pathname.match(/^\/api\/v1\/trips\/([a-zA-Z0-9_-]+)\/segments\/([a-zA-Z0-9_-]+)\/swap-fallback\/?$/);
      if (swapMatch && request.method === "POST") {
        const tripId = swapMatch[1], sid = swapMatch[2];
        const store = await loadStore(env, currentUid);
        const t = store.trips[tripId];
        if (!t) return cors(json({ error: "Trip not found" }, 404));
        const s = (t.segments || []).find(x => x.sid === sid);
        if (!s) return cors(json({ error: "Segment not found" }, 404));
        if (!s.fallback || !s.fallback.name) {
          return cors(json({ error: "No contingency fallback plan configured for this segment" }, 400));
        }
        const oldPrimary = {
          name: s.name,
          address: s.address || "",
          note: s.note || "",
          mapsUrl: s.mapsUrl || "",
          rating: s.rating !== undefined ? s.rating : null,
          userRatingsTotal: s.userRatingsTotal !== undefined ? s.userRatingsTotal : null,
          openNow: s.openNow !== undefined ? s.openNow : null,
          placeId: s.placeId || ""
        };
        s.name = s.fallback.name;
        s.address = s.fallback.address || "";
        s.note = s.fallback.note || "";
        s.mapsUrl = s.fallback.mapsUrl || "";
        s.rating = s.fallback.rating !== undefined ? s.fallback.rating : null;
        s.userRatingsTotal = s.fallback.userRatingsTotal !== undefined ? s.fallback.userRatingsTotal : null;
        s.openNow = s.fallback.openNow !== undefined ? s.fallback.openNow : null;
        s.placeId = s.fallback.placeId || "";
        s.fallback = oldPrimary;
        s.source = "manual";
        t.updatedAt = Date.now();
        await saveStore(env, store, currentUid);
        return cors(json({ ok: true, swapped: true, segment: s }));
      }

      // POST /api/v1/places/search - Google Places Text Search
      if (url.pathname === "/api/v1/places/search" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        const query = ((body && body.query) || "").trim();
        const lang = ((body && body.language) || "zh-TW").trim();
        const result = await searchGooglePlaces(env, query, lang);
        if (!result.ok) return cors(json(result, result.status || 400));
        return cors(json(result));
      }

      // POST /api/v1/places/details - Google Places Details
      if (url.pathname === "/api/v1/places/details" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        const placeId = ((body && body.placeId) || "").trim();
        const lang = ((body && body.language) || "zh-TW").trim();
        const result = await getGooglePlaceDetails(env, placeId, lang);
        if (!result.ok) return cors(json(result, result.status || 400));
        return cors(json(result));
      }

      // GET /api/v1/wishes - List Wishlist Radar items
      if (url.pathname === "/api/v1/wishes" && request.method === "GET") {
        const store = await loadStore(env, currentUid);
        const wishes = store.wishes || [];
        return cors(json({ ok: true, count: wishes.length, wishes }));
      }

      // POST /api/v1/wishes - Add or update Wishlist Radar item
      if (url.pathname === "/api/v1/wishes" && request.method === "POST") {
        const body = await request.json().catch(() => null);
        if (!body || typeof body !== "object") return cors(json({ error: "Invalid JSON body" }, 400));
        const store = await loadStore(env, currentUid);
        store.wishes = store.wishes || [];
        const id = body.id || uid();
        const wishItem = {
          id,
          from: (body.from || "").toUpperCase(),
          dest: String(body.dest || body.to || "").trim(),
          days: String(body.days || "").trim(),
          month: String(body.month || "").trim(),
          budget: String(body.budget || "").trim(),
          note: String(body.note || "").trim(),
          updatedAt: Date.now()
        };
        const idx = store.wishes.findIndex(w => w.id === id);
        if (idx >= 0) store.wishes[idx] = wishItem;
        else store.wishes.push(wishItem);
        await saveStore(env, store, currentUid);
        return cors(json({ ok: true, wish: wishItem }, 201));
      }

      // DELETE /api/v1/wishes/:id - Delete Wishlist Radar item
      const wishDelMatch = url.pathname.match(/^\/api\/v1\/wishes\/([a-zA-Z0-9_-]+)\/?$/);
      if (wishDelMatch && request.method === "DELETE") {
        const wishId = wishDelMatch[1];
        const store = await loadStore(env, currentUid);
        store.wishes = store.wishes || [];
        const before = store.wishes.length;
        store.wishes = store.wishes.filter(w => w.id !== wishId);
        if (store.wishes.length !== before) {
          await saveStore(env, store, currentUid);
        }
        return cors(json({ ok: true, deleted: true, id: wishId }));
      }

      // POST /api/v1/sync - Trigger on-demand sync of Google Calendar & Gmail
      if (url.pathname === "/api/v1/sync" && request.method === "POST") {
        if (currentUid !== "usr_admin") {
          return cors(json({ error: "Google Calendar & Gmail sync is restricted to administrator" }, 403));
        }
        const only = url.searchParams.get("only") || "";
        const stats = await runSync(env, only);
        return cors(json({ ok: true, syncStats: stats }));
      }

      // GET /api/v1/backups - List cloud snapshot backups
      if (url.pathname === "/api/v1/backups" && request.method === "GET") {
        if (currentUid !== "usr_admin") {
          return cors(json({ error: "System snapshots are restricted to administrator" }, 403));
        }
        const out = [];
        for (const slot of ["0", "1", "2", "3", "pre"]) {
          const raw = await env.TRIPS.get("backup:" + slot);
          if (!raw) continue;
          try {
            const b = JSON.parse(raw);
            const s = JSON.parse(b.raw);
            out.push({ slot, at: b.at, trips: Object.keys(s.trips || {}).length });
          } catch (e) {}
        }
        out.sort((a, b) => b.at - a.at);
        return cors(json({ ok: true, backups: out }));
      }

      // GET /api/v1/export - Full JSON export
      if (url.pathname === "/api/v1/export" && request.method === "GET") {
        const store = await loadStore(env, currentUid);
        const home = (await env.TRIPS.get("home")) || "TPE";
        const homeTz = (await env.TRIPS.get("home_tz")) || "Asia/Taipei";
        return cors(json({
          version: 2,
          exportedAt: new Date().toISOString(),
          home,
          homeTz,
          trips: Object.values(store.trips).sort((a, b) => ((a.start || "") < (b.start || "") ? -1 : 1)),
          wishes: store.wishes || []
        }));
      }

      // POST /api/v1/copilot/chat - AI Travel Copilot Chat with active trip context
      if (url.pathname === "/api/v1/copilot/chat" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        const rawMessages = Array.isArray(body && body.messages) ? body.messages : [];
        const currentTripId = ((body && body.currentTripId) || "").trim();
        const result = await dispatchAiChat(env, rawMessages, currentTripId, currentUid);
        if (!result.ok) return cors(json(result, result.status || 400));
        return cors(json(result));
      }

      return cors(json({ error: "Not found" }, 404));
    }

    const blocked = await authGuard(request, env);
    if (blocked) return cors(blocked);
    const currentUid = (request.session && request.session.uid) || "usr_admin";

    // --- App settings snapshot the front end reads to show connection status.
    // Google, LLM and Resend connect in-app (keys saved to YOUR OWN KV, used only
    // server-side, never returned to the browser in full) or via dashboard
    // secrets, which always win.
    if (url.pathname === "/settings" && request.method === "GET") {
      const gClient = await googleClient(env);
      const gRefresh = env.GOOGLE_REFRESH_TOKEN || (await env.TRIPS.get("g_refresh")) || "";
      const gIcs = (await env.TRIPS.get("g_ics")) || "";
      const llm = await getLLMConfig(env, currentUid);
      const resend = await getResendConfig(env);
      const places = await getGooglePlacesConfig(env);

      let home = "", homeTz = "", units = "";
      if (currentUid !== "usr_admin") {
        try {
          const pRaw = await env.TRIPS.get("user:" + currentUid + ":profile");
          if (pRaw) {
            const p = JSON.parse(pRaw);
            home = p.home || "";
            homeTz = p.homeTz || "";
            units = p.units || "";
          }
        } catch(e) {}
      }
      if (!home) home = (await env.TRIPS.get("home")) || "";
      if (!homeTz) homeTz = (await env.TRIPS.get("home_tz")) || "";
      if (!units) units = (await env.TRIPS.get("units")) || "";

      const userAgentKey = await env.TRIPS.get("user:" + currentUid + ":agent_key");
      const agentKey = userAgentKey || (currentUid === "usr_admin" ? (await env.TRIPS.get("agent_api_key")) : "");
      return cors(json({
        home,
        homeTz,
        units,
        googleClientSet: !!gClient,
        googleClientId: gClient ? gClient.id : null,
        googleConnected: !!(gClient && gRefresh),
        googleSource: env.GOOGLE_REFRESH_TOKEN ? "secret" : (gRefresh ? "in-app" : "none"),
        gcalIcsSet: !!gIcs,
        gcalIcsMask: gIcs ? maskIcs(gIcs) : null,
        gmailEmail: (await env.TRIPS.get("g_email")) || null,
        // LLM Configuration
        llmProvider: llm.provider,
        llmBaseUrl: llm.baseUrl,
        llmModel: llm.model,
        llmFallbackModel: llm.fallbackModel || "",
        llmConfigured: !!llm.apiKey,
        llmSource: llm.source,
        llmByokRequired: Boolean(llm.byokRequired),
        // User & Tenant info
        currentUser: request.session ? { uid: request.session.uid, email: request.session.email, role: request.session.role } : null,
        isTenant: currentUid !== "usr_admin",
        // Backward-compat flag
        anthropicKeySet: !!llm.apiKey,
        // Resend Configuration
        resendConfigured: !!resend.apiKey,
        resendFrom: resend.from,
        resendSource: resend.source,
        // Google Places Configuration
        googlePlacesConfigured: places.configured,
        googlePlacesSource: places.source,
        // AI Agent Key Configuration
        agentKeyConfigured: !!agentKey,
      }));
    }

    // Agent API Key Management (Per-tenant isolated key generation, status, and revocation)
    if (url.pathname === "/settings/agent-key" && request.method === "GET") {
      const userKey = await env.TRIPS.get("user:" + currentUid + ":agent_key");
      const key = userKey || (currentUid === "usr_admin" ? (await env.TRIPS.get("agent_api_key")) : null);
      const mask = key ? (key.slice(0, 11) + "..." + key.slice(-4)) : null;
      return cors(json({ configured: !!key, keyMask: mask }));
    }
    if (url.pathname === "/settings/agent-key" && request.method === "POST") {
      const oldKey = await env.TRIPS.get("user:" + currentUid + ":agent_key");
      if (oldKey) {
        await env.TRIPS.delete("agent_token:" + oldKey);
      }
      const newKey = "rr_agent_" + randHex(24);
      await env.TRIPS.put("user:" + currentUid + ":agent_key", newKey);
      await env.TRIPS.put("agent_token:" + newKey, JSON.stringify({
        uid: currentUid,
        email: (request.session && request.session.email) || "",
        role: (request.session && request.session.role) || "user"
      }));
      if (currentUid === "usr_admin") {
        await env.TRIPS.put("agent_api_key", newKey);
      }
      return cors(json({ ok: true, key: newKey }));
    }
    if (url.pathname === "/settings/agent-key" && request.method === "DELETE") {
      const oldKey = await env.TRIPS.get("user:" + currentUid + ":agent_key");
      if (oldKey) {
        await env.TRIPS.delete("agent_token:" + oldKey);
        await env.TRIPS.delete("user:" + currentUid + ":agent_key");
      }
      if (currentUid === "usr_admin") {
        const legacyKey = await env.TRIPS.get("agent_api_key");
        if (legacyKey) await env.TRIPS.delete("agent_token:" + legacyKey);
        await env.TRIPS.delete("agent_api_key");
      }
      return cors(json({ ok: true, cleared: true }));
    }


    // --- In-app Google connection (self-host friendly).
    // Paste an OAuth client id/secret in Settings, click Connect, approve the
    // consent screen; the refresh token lands in YOUR OWN KV and never leaves
    // the worker. Dashboard secrets (GOOGLE_*), if present, always win.
    if (url.pathname === "/settings/google" && request.method === "POST") {
      if (currentUid !== "usr_admin") return cors(json({ error: "Google connection is restricted to administrator" }, 403));
      const body = await request.json().catch(() => ({}));
      // strip ALL whitespace: Google shows these wrapped over several lines, so copies pick up breaks
      const id = ((body && body.clientId) || "").replace(/\s+/g, "");
      const secret = ((body && body.clientSecret) || "").replace(/\s+/g, "");
      if (!id && !secret) {                                    // disconnect
        await env.TRIPS.delete("g_client");
        await env.TRIPS.delete("g_refresh");
        return cors(json({ ok: true }));
      }
      if (!id || !secret) return cors(json({ error: "Client ID and client secret are both needed." }, 400));
      if (!/^\d+-[a-z0-9]+\.apps\.googleusercontent\.com$/.test(id))
        return cors(json({ error: "That client ID doesn't look right - it should be digits, a dash, letters, ending in .apps.googleusercontent.com (copy it from the Clients page or the JSON's client_id field, not the filename)." }, 400));
      if (!/^GOCSPX-/.test(secret))
        return cors(json({ error: "The client secret starts with GOCSPX- (find it on the client's page or the JSON's client_secret field)." }, 400));
      await env.TRIPS.put("g_client", JSON.stringify({ id, secret }));
      return cors(json({ ok: true }));
    }

    // Universal LLM Configuration (OpenAI compatible Base URL, Gemini, Groq, DeepSeek, Anthropic)
    if (url.pathname === "/settings/llm" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const provider = ((body && body.provider) || "openai").trim().toLowerCase();
      const baseUrl = ((body && body.baseUrl) || "").trim();
      const apiKey = ((body && body.apiKey) || "").replace(/\s+/g, "");
      const model = ((body && body.model) || "").trim();
      const fallbackModel = ((body && body.fallbackModel) || "").trim();

      if (!apiKey && !baseUrl && !model && !fallbackModel) {
        // Clear custom configuration
        if (currentUid === "usr_admin") {
          await env.TRIPS.delete("llm_config");
          await env.TRIPS.delete("user:usr_admin:llm_config");
          await env.TRIPS.delete("anthropic_key");
          delete env._llmConfig;
        } else {
          await env.TRIPS.delete("user:" + currentUid + ":llm_config");
        }
        return cors(json({ ok: true, cleared: true }));
      }

      // If user is setting a new key or updating config
      const existing = await getLLMConfig(env, currentUid);
      const newConfig = {
        provider: provider || existing.provider || "openai",
        baseUrl: baseUrl !== undefined ? baseUrl : existing.baseUrl,
        apiKey: apiKey || existing.apiKey || "",
        model: model || existing.model || "",
        fallbackModel: fallbackModel !== undefined ? fallbackModel : (existing.fallbackModel || (provider === "groq" ? "openai/gpt-oss-120b" : ""))
      };

      if (!newConfig.apiKey) {
        return cors(json({ error: "API 金鑰為必填欄位 / API key is required" }, 400));
      }

      if (currentUid === "usr_admin") {
        await env.TRIPS.put("llm_config", JSON.stringify(newConfig));
        await env.TRIPS.put("user:usr_admin:llm_config", JSON.stringify(newConfig));
        delete env._llmConfig;
      } else {
        await env.TRIPS.put("user:" + currentUid + ":llm_config", JSON.stringify(newConfig));
      }
      return cors(json({ ok: true }));
    }

    // Fetch live model list from LLM Provider (OpenAI, Groq, DeepSeek, Gemini, Anthropic, Custom)
    if (url.pathname === "/settings/llm/models" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      let provider = ((body && body.provider) || "").trim().toLowerCase();
      let baseUrl = ((body && body.baseUrl) || "").trim();
      let apiKey = ((body && body.apiKey) || "").replace(/\s+/g, "");

      const saved = await getLLMConfig(env, currentUid);
      if (!provider) provider = saved.provider || "openai";
      if (!baseUrl && provider !== "anthropic") baseUrl = saved.baseUrl;
      if (!apiKey) apiKey = saved.apiKey;

      if (!apiKey) {
        return cors(json({ error: "尚未提供或設定 API 金鑰，請先輸入 API Key 後再點擊取得模型清單。" }, 400));
      }

      try {
        let models = [];
        if (provider === "anthropic") {
          const res = await fetch("https://api.anthropic.com/v1/models", {
            headers: {
              "x-api-key": apiKey,
              "anthropic-version": "2023-06-01"
            }
          });
          if (!res.ok) {
            const errText = await res.text().catch(() => "");
            return cors(json({ error: `Anthropic API 錯誤 (${res.status}): ${errText.slice(0, 150)}` }, res.status));
          }
          const data = await res.json();
          models = (data.data || []).map((m) => m.id);
        } else {
          let endpoint = (baseUrl || "").replace(/\/+$/, "");
          if (!endpoint) {
            if (provider === "gemini") endpoint = "https://generativelanguage.googleapis.com/v1beta/openai";
            else if (provider === "groq") endpoint = "https://api.groq.com/openai/v1";
            else if (provider === "deepseek") endpoint = "https://api.deepseek.com/v1";
            else endpoint = "https://api.openai.com/v1";
          }
          const res = await fetch(`${endpoint}/models`, {
            headers: {
              "Authorization": `Bearer ${apiKey}`,
              "Content-Type": "application/json"
            }
          });
          if (!res.ok) {
            const errText = await res.text().catch(() => "");
            return cors(json({ error: `模型查詢失敗 (${res.status}): ${errText.slice(0, 150)}` }, res.status));
          }
          const data = await res.json();
          const list = data.data || [];
          models = list.map((m) => m.id || m.name).filter(Boolean);
        }

        models.sort();
        return cors(json({ ok: true, provider, models }));
      } catch (err) {
        return cors(json({ error: "連線至模型提供者失敗: " + err.message }, 500));
      }
    }

    // Save general user preferences (home base, home timezone, units)
    if (url.pathname === "/settings/profile" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      if (currentUid === "usr_admin") {
        if (body.home !== undefined) await env.TRIPS.put("home", String(body.home).toUpperCase());
        if (body.homeTz !== undefined) await env.TRIPS.put("home_tz", String(body.homeTz));
        if (body.units !== undefined) await env.TRIPS.put("units", String(body.units));
      } else {
        let p = {};
        try {
          const pRaw = await env.TRIPS.get("user:" + currentUid + ":profile");
          if (pRaw) p = JSON.parse(pRaw);
        } catch(e) {}
        if (body.home !== undefined) p.home = String(body.home).toUpperCase();
        if (body.homeTz !== undefined) p.homeTz = String(body.homeTz);
        if (body.units !== undefined) p.units = String(body.units);
        await env.TRIPS.put("user:" + currentUid + ":profile", JSON.stringify(p));
      }
      return cors(json({ ok: true }));
    }

    // Legacy Anthropic key endpoint (backward compatible)
    if (url.pathname === "/settings/anthropickey" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const key = ((body && body.key) || "").replace(/\s+/g, "");
      if (key === "") {
        await env.TRIPS.delete("anthropic_key");
        await env.TRIPS.delete("llm_config");
        delete env._llmConfig;
        return cors(json({ ok: true }));
      }
      if (!/^sk-ant-/.test(key)) return cors(json({ error: "An Anthropic API key starts with sk-ant- (console.anthropic.com -> API Keys)." }, 400));
      await env.TRIPS.put("anthropic_key", key);
      await env.TRIPS.put("llm_config", JSON.stringify({ provider: "anthropic", baseUrl: "", apiKey: key, model: "claude-haiku-4-5" }));
      delete env._llmConfig;
      return cors(json({ ok: true }));
    }

    // In-App AI Travel Assistant (Copilot Chat Gateway)
    if (url.pathname === "/ai/chat" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const rawMessages = Array.isArray(body && body.messages) ? body.messages : [];
      const currentTripId = ((body && body.currentTripId) || "").trim();
      const result = await dispatchAiChat(env, rawMessages, currentTripId, currentUid);
      if (!result.ok) return cors(json(result, result.status || 400));
      return cors(json(result));
    }

    // Resend Email Delivery Settings
    if (url.pathname === "/settings/resend" && request.method === "POST") {
      if (currentUid !== "usr_admin") return cors(json({ error: "Resend configuration is restricted to administrator" }, 403));
      const body = await request.json().catch(() => ({}));
      const apiKey = ((body && body.apiKey) || "").replace(/\s+/g, "");
      const from = ((body && body.from) || "").trim();

      if (apiKey === "") {
        await env.TRIPS.delete("resend_config");
        await env.TRIPS.delete("resend_key");
        delete env._resendConfig;
        return cors(json({ ok: true, cleared: true }));
      }

      if (!apiKey.startsWith("re_")) {
        return cors(json({ error: "Resend API Key 通常以 re_ 開頭，請至 resend.com/api-keys 取得 / Resend API key usually starts with re_" }, 400));
      }

      const resendData = { apiKey, from: from || "888travel <onboarding@resend.dev>" };
      await env.TRIPS.put("resend_config", JSON.stringify(resendData));
      delete env._resendConfig;
      return cors(json({ ok: true }));
    }

    // Test Resend Email Sending
    if (url.pathname === "/settings/resend/test" && request.method === "POST") {
      if (currentUid !== "usr_admin") return cors(json({ error: "Resend test is restricted to administrator" }, 403));
      const body = await request.json().catch(() => ({}));
      const storedEmail = await env.TRIPS.get("auth_email");
      const targetEmail = ((body && body.to) || storedEmail || "").trim();
      if (!targetEmail) return cors(json({ error: "請指定接收測試信的信箱 / Target email required" }, 400));

      try {
        const res = await sendEmailViaResend(env, {
          to: targetEmail,
          subject: "【888漫步旅遊 / 888travel】Resend 郵件寄送測試成功！",
          text: `恭喜！您的 888漫步旅遊 (888travel) Resend 郵件服務已成功連線！\n發送時間：${new Date().toLocaleString()}`,
          html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'PingFang TC',sans-serif;max-width:480px;margin:0 auto;background:#ECE7DC;padding:32px 20px;border-radius:16px;">
            <div style="background:#FFF;border-radius:12px;padding:28px 24px;text-align:center;">
              <h3 style="color:#1B8A57;margin:0 0 12px;">✓ Resend 郵件寄送測試成功</h3>
              <p style="color:#756D5E;font-size:14px;line-height:1.6;margin:0 0 16px;">恭喜！您的 888漫步旅遊 (888travel) 郵件發送服務已正常啟用，後續可用於 OTP 驗證碼登入及行程通知。</p>
              <div style="font-size:12px;color:#A39A89;">測試時間：${new Date().toISOString()}</div>
            </div>
          </div>`
        });
        return cors(json({ ok: true, id: res.id, to: targetEmail }));
      } catch (err) {
        return cors(json({ ok: false, error: err.message || String(err) }, 500));
      }
    }

    // Google Places API Settings (In-app key configuration)
    if (url.pathname === "/settings/places" && request.method === "POST") {
      if (currentUid !== "usr_admin") return cors(json({ error: "Google Places configuration is restricted to administrator" }, 403));
      const body = await request.json().catch(() => ({}));
      const apiKey = ((body && body.apiKey) || "").replace(/\s+/g, "");
      if (apiKey === "") {
        await env.TRIPS.delete("google_places_key");
        delete env._placesConfig;
        return cors(json({ ok: true, cleared: true }));
      }
      await env.TRIPS.put("google_places_key", apiKey);
      delete env._placesConfig;
      return cors(json({ ok: true }));
    }

    // Google Places API Test Connection
    if (url.pathname === "/settings/places/test" && request.method === "POST") {
      if (currentUid !== "usr_admin") return cors(json({ error: "Google Places test is restricted to administrator" }, 403));
      const places = await getGooglePlacesConfig(env);
      if (!places.apiKey) {
        return cors(json({ ok: false, error: "尚未設定 Google Places API Key / Google Places API Key not configured" }, 400));
      }
      const body = await request.json().catch(() => ({}));
      const query = ((body && body.query) || "Tokyo Tower").trim();
      try {
        const res = await fetch(`https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&key=${places.apiKey}&language=zh-TW`);
        const data = await res.json();
        if (data.status === "REQUEST_DENIED") {
          return cors(json({ ok: false, error: `Google Places 授權失敗: ${data.error_message || "API Key 權限被拒絕，請確認已在 Google Cloud 啟用 Places API"}` }, 403));
        }
        if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
          return cors(json({ ok: false, error: `Google Places 錯誤 (${data.status}): ${data.error_message || ""}` }, 400));
        }
        const sample = (data.results || [])[0];
        return cors(json({
          ok: true,
          count: (data.results || []).length,
          sample: sample ? { name: sample.name, address: sample.formatted_address, rating: sample.rating } : null
        }));
      } catch (err) {
        return cors(json({ ok: false, error: "連線至 Google Places 失敗: " + (err.message || String(err)) }, 500));
      }
    }

    // Google Places Search (Find restaurants, attractions, addresses, ratings, and open status)
    if (url.pathname === "/places/search" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const query = ((body && body.query) || "").trim();
      const lang = ((body && body.language) || "zh-TW").trim();
      const result = await searchGooglePlaces(env, query, lang);
      if (!result.ok) return cors(json(result, result.status || 400));
      return cors(json(result));
    }

    // Google Places Details
    if (url.pathname === "/places/details" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const placeId = ((body && body.placeId) || "").trim();
      const lang = ((body && body.language) || "zh-TW").trim();
      const result = await getGooglePlaceDetails(env, placeId, lang);
      if (!result.ok) return cors(json(result, result.status || 400));
      return cors(json(result));
    }
    // What can the Google connection actually see? Split by stage, so "no travel
    // info appeared" points at the exact culprit.
    if (url.pathname === "/google/test" && request.method === "GET") {
      if (currentUid !== "usr_admin") return cors(json({ ok: false, error: "Google connection is restricted to administrator" }, 403));
      const token = await googleToken(env);
      if (!token) return cors(json({ ok: false, error: "Not connected - no refresh token yet." }));
      const out = { ok: true, anthropicKeySet: !!(await anthropicKey(env)) };
      const calId = env.GOOGLE_CALENDAR_ID || "primary";
      try {
        const r = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events?singleEvents=true&maxResults=250&timeMin=${encodeURIComponent(new Date().toISOString())}&timeMax=${encodeURIComponent(new Date(Date.now() + 400 * 864e5).toISOString())}`,
          { headers: { Authorization: `Bearer ${token}` } });
        const d = await r.json().catch(() => ({}));
        out.calendar = r.ok
          ? { ok: true, upcoming: (d.items || []).length,
              sample: (d.items || []).filter((ev) => !(ev.extendedProperties && ev.extendedProperties.private && ev.extendedProperties.private.travelSyncTrip))
                .slice(0, 4).map((ev) => (ev.summary || "?") + " (" + ((ev.start && (ev.start.date || ev.start.dateTime)) || "").slice(0, 10) + ")") }
          : { ok: false, error: (d.error && d.error.message) || ("HTTP " + r.status) };
      } catch (e) { out.calendar = { ok: false, error: "unreachable" }; }
      try {
        const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=1&q=${encodeURIComponent(await gmailQuery(env, token))}`, { headers: { Authorization: `Bearer ${token}` } });
        const d = await r.json().catch(() => ({}));
        out.gmail = r.ok ? { ok: true, matches: d.resultSizeEstimate || 0 } : { ok: false, error: (d.error && d.error.message) || ("HTTP " + r.status) };
      } catch (e) { out.gmail = { ok: false, error: "unreachable" }; }
      const store = await loadStore(env);
      out.trips = Object.values(store.trips).filter((t) => t.start && t.end).length;
      out.seenEmails = Object.keys(store.seenEmails || {}).length;
      out.unfiled = (store.unfiled || []).slice(-5);
      return cors(json(out));
    }
    // Forget which emails were already scanned (e.g. after adding the
    // ANTHROPIC_API_KEY). Deliberately does NOT kick a sync: the app follows up
    // with its own /sync passes, and a background run here would race the first
    // of those (two runSyncs on the same store = double Claude spend).
    if (url.pathname === "/gmail/rescan" && request.method === "POST") {
      if (currentUid !== "usr_admin") return cors(json({ error: "Gmail rescan is restricted to administrator" }, 403));
      const store = await loadStore(env);
      store.seenEmails = {};
      await saveStore(env, store);
      return cors(json({ ok: true }));
    }
    // Step-by-step trace of the newest forwarded (+trip) or matching email.
    // Answers "where exactly does my email die" in one call, without marking
    // anything as seen.
    if (url.pathname === "/gmail/trace" && request.method === "GET") {
      if (currentUid !== "usr_admin") return cors(json({ ok: false, error: "Gmail trace is restricted to administrator" }, 403));
      const token = await googleToken(env);
      if (!token) return cors(json({ ok: false, error: "Google not connected." }));
      const out = { ok: true };
      try {
        const em = (await env.TRIPS.get("g_email")) || "";
        const plus = em.includes("@") ? em.replace("@", "+trip@") : "";
        out.plusAddress = plus || null;
        let q = plus ? "to:" + plus : "";
        let list = { messages: [] };
        if (q) {
          const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=1&q=${encodeURIComponent(q)}`, { headers: { Authorization: `Bearer ${token}` } });
          list = await r.json().catch(() => ({}));
          out.plusMatches = list.resultSizeEstimate || 0;
        }
        if (!(list.messages || []).length) {
          out.fallbackQueryUsed = true;
          const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=1&q=${encodeURIComponent(await gmailQuery(env, token))}`, { headers: { Authorization: `Bearer ${token}` } });
          list = await r.json().catch(() => ({}));
        }
        const m = (list.messages || [])[0];
        if (!m) { out.step = "search"; out.result = "No matching email found at all - the search sees nothing."; return cors(json(out)); }
        out.messageId = m.id;
        const store = await loadStore(env);
        out.alreadySeen = !!((store.seenEmails || {})[m.id]);
        const gm = await gmailMessage(token, m.id);
        const text = gm.text;
        out.textLength = text.length;
        if (!text) { out.step = "extract"; out.result = "Found the email but could not read any text from it."; return cors(json(out)); }
        const segs = await extractSegments(env, text, gm.plus);
        if (segs === undefined) { out.step = "parse"; out.result = "Could not reach the Anthropic API (key missing or API down)."; return cors(json(out)); }
        const seg = segs.find((s) => s.start) || (gm.plus && segs[0]) || null;
        if (!seg) { out.step = "parse"; out.result = "The model judged this email is not a real booking."; return cors(json(out)); }
        out.parsed = { type: seg.type, name: seg.name, start: seg.start, end: seg.end, note: seg.note };
        if (segs.length > 1) out.parsedCount = segs.length;
        out.step = "done";
        if (!seg.start) {
          const byCity = await findTripByCity(store, seg.city || seg.name);
          out.result = byCity
            ? "No dates in this email - sync will file it into your \"" + (byCity.label || byCity.to) + "\" trip by destination."
            : "No dates in this email and no trip matches \"" + (seg.city || seg.name) + "\" - add that trip and re-scan.";
          return cors(json(out));
        }
        const trip = await findTripForSeg(store, seg, seg.city || "");
        out.result = (trip
          ? "Would file into trip: " + (trip.label || trip.to) + ". If it isn't there, hit Re-scan inbox (it may be marked seen from before a fix)."
          : (seg.type === "hotel" && seg.end && seg.end > seg.start
            ? "No trip covers these dates - the next sync will CREATE a \"" + (seg.city || seg.name) + "\" trip for this stay."
            : (seg.type === "flight" && segs.filter((s) => s.type === "flight" && s.start).length >= 2
              ? "No trip covers these dates - the next sync will CREATE a trip spanning these flights."
              : "Parsed fine but NO trip covers " + seg.start + " - create or widen a trip around that date.")))
          + (segs.length > 1 ? " (this email holds " + segs.length + " plans - all are imported on sync)" : "");
        return cors(json(out));
      } catch (e) { out.ok = false; out.error = String((e && e.message) || e); return cors(json(out)); }
    }
    // One-time broom: drop every auto-imported plan (calendar/gmail) from every
    // trip and forget scanned emails, then re-import fresh through the current
    // relevance filter. Manual plans are untouched - house rule.
    if (url.pathname === "/plans/reset" && request.method === "POST") {
      // destructive: keep an automatic copy first, restorable from Settings
      const cur = await env.TRIPS.get("store");
      if (cur) await env.TRIPS.put("backup:pre", JSON.stringify({ at: Date.now(), raw: cur }));
      const store = await loadStore(env);
      let removed = 0;
      for (const t of Object.values(store.trips)) {
        const before = (t.segments || []).length;
        t.segments = (t.segments || []).filter((s) => !s.source || s.source === "manual");
        removed += before - t.segments.length;
      }
      store.seenEmails = {};
      await saveStore(env, store);
      // No background sync kick here either - the app runs the re-import passes
      // itself right after this call and reports progress on screen.
      return cors(json({ ok: true, removed }));
    }
    // The easy calendar link: the "Secret address in iCal format" from normal
    // Google Calendar settings. No Google Cloud project, no OAuth, no consent
    // screen - the worker just reads that private feed on every sync.
    if (url.pathname === "/settings/gcalics" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const ics = ((body && body.url) || "").replace(/\s+/g, ""); // long URLs pick up line breaks when copied on mobile
      if (ics === "") { await env.TRIPS.delete("g_ics"); return cors(json({ ok: true })); }
      if (!/^https:\/\//.test(ics)) return cors(json({ error: "That doesn't look like a link - it should start with https://" }, 400));
      if (/\/public\/(basic|full)\.ics/.test(ics)) return cors(json({ error: "That's the PUBLIC address - copy the \"Secret address in iCal format\" instead (same page, a little further down)." }, 400));
      await env.TRIPS.put("g_ics", ics);
      return cors(json({ ok: true }));
    }
    // "Test link" in Settings: what does the worker actually see in the feed,
    // and does any of it land inside a trip? Answers "why didn't my hotel
    // show up" without dashboard access.
    if (url.pathname === "/gcal/test" && request.method === "GET") {
      const icsUrl = (await env.TRIPS.get("g_ics")) || "";
      if (!icsUrl) return cors(json({ ok: false, error: "No calendar linked yet." }));
      let res;
      try { res = await fetch(icsUrl); } catch (e) { return cors(json({ ok: false, error: "Could not reach that address." })); }
      if (!res.ok) return cors(json({ ok: false, error: "Google said " + res.status + " for " + maskIcs(icsUrl) + " - re-copy the Secret address (a reset invalidates old links)." }));
      const text = await res.text();
      const events = parseICS(text);
      const calName = ((text.match(/^X-WR-CALNAME[^:]*:(.*)$/m) || [])[1] || "").trim();
      const store = await loadStore(env);
      const trips = Object.values(store.trips).filter((t) => t.start && t.end);
      const inTrip = events.filter((ev) => ev.start && !/^Trip: /.test(ev.summary || "")
        && trips.some((t) => ev.start <= t.end && (ev.end || ev.start) >= t.start));
      return cors(json({
        ok: true, events: events.length, trips: trips.length, matching: inTrip.length, calName,
        sample: inTrip.slice(0, 5).map((ev) => (ev.summary || "Event") + " (" + ev.start + ")"),
      }));
    }

    // Your app reads the consolidated, segment-enriched trips from here.
    if (url.pathname === "/trips" && request.method === "GET") {
      const store = await loadStore(env, currentUid);
      return cors(json(Object.values(store.trips).sort((a, b) => (a.start < b.start ? -1 : 1))));
    }
    // Your app creates OR updates a trip here. Manual plans you edit are merged with ingested ones.
    if (url.pathname === "/trips" && request.method === "POST") {
      const store = await loadStore(env, currentUid);
      const body = await request.json().catch(() => null);
      if (!body || typeof body !== "object") return cors(json({ error: "invalid trip body" }, 400));
      const id = body.id || uid();
      const existing = store.trips[id];
      if (existing) {
        const ingested = (existing.segments || []).filter((s) => s.source && s.source !== "manual");
        const manual = (body.segments || []).filter((s) => !s.source || s.source === "manual");
        store.trips[id] = { ...existing, from: body.from, to: body.to, start: body.start, end: body.end,
          label: body.label, notes: body.notes || "", timezone: body.timezone !== undefined ? body.timezone : (existing.timezone || ""),
          segments: dedupeSegs([...manual, ...ingested]),
          photo: body.photo !== undefined ? body.photo : (existing.photo || ""), updatedAt: Date.now() };
      } else {
        store.trips[id] = { id, from: body.from || "", to: body.to || "",
          start: body.start, end: body.end, label: body.label || "", notes: body.notes || "",
          timezone: body.timezone || "", segments: body.segments || [],
          photo: body.photo || "", updatedAt: Date.now() };
      }
      await saveStore(env, store, currentUid);
      if (currentUid === "usr_admin") {
        ctx.waitUntil(debouncedEditSync(env)); // enrich from calendar/email, coalescing rapid edits
      }
      return cors(json(store.trips[id]));
    }
    // Delete a trip from the hub. Without this, a delete in the app only removed
    // the local copy and the worker's copy resurrected it on every refresh.
    if (url.pathname === "/trips/delete" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const store = await loadStore(env, currentUid);
      const t = body && body.id ? store.trips[body.id] : null;
      if (t) {
        delete store.trips[body.id];
        await saveStore(env, store, currentUid);
      }
      return cors(json({ ok: true, deleted: !!t }));
    }
    // Delete ONE plan and remember it. You deleted it on purpose (a hotel that
    // replied about an event, not your trip), so it must never come back: the
    // segment's conf is tombstoned in store.deletedSegs, and addSegment refuses
    // to re-add any conf listed there - blocking every source (calendar re-read,
    // Gmail re-scan, Clean re-import). Manual plans are removed too.
    if (url.pathname === "/segments/delete" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const store = await loadStore(env, currentUid);
      const t = body && body.tripId ? store.trips[body.tripId] : null;
      let removed = 0;
      if (t) {
        store.deletedSegs = store.deletedSegs || {};
        const conf = body.conf || "";
        const sid = body.sid || "";
        const before = (t.segments || []).length;
        t.segments = (t.segments || []).filter((s) => {
          const hit = (conf && s.conf === conf) || (sid && s.sid === sid);
          if (hit && s.conf) store.deletedSegs[s.conf] = Date.now();  // tombstone by conf
          return !hit;
        });
        removed = before - t.segments.length;
        // Also tombstone the conf the app sent even if the stored copy differs,
        // so a re-ingest in flight can't slip it back in.
        if (conf) store.deletedSegs[conf] = Date.now();
        if (removed) t.updatedAt = Date.now();
        await saveStore(env, store, currentUid);
      }
      return cors(json({ ok: true, removed }));
    }
    // Mint (or revoke) the companion-view token for one trip. The returned URL
    // is the whole credential - share it only with your travel companions.
    if (url.pathname === "/trips/share" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const store = await loadStore(env, currentUid);
      const t = store.trips[body.id];
      if (!t) return cors(json({ error: "no such trip" }, 404));
      if (body.revoke) {
        if (t.shareToken) await env.TRIPS.delete("share:" + t.shareToken);
        delete t.shareToken;
        await saveStore(env, store, currentUid);
        return cors(json({ ok: true, revoked: true }));
      }
      if (!t.shareToken) {
        t.shareToken = randHex(16);
        await saveStore(env, store, currentUid);
      }
      await env.TRIPS.put("share:" + t.shareToken, JSON.stringify({ uid: currentUid, tripId: t.id }));
      return cors(json({ ok: true, url: url.origin + "/t/" + t.shareToken }));
    }
    // Mint (once) the private calendar-feed URL.
    if (url.pathname === "/ics/token" && request.method === "POST") {
      let tok = (await env.TRIPS.get("ics_token:" + currentUid)) || "";
      if (!tok) {
        tok = randHex(16);
        await env.TRIPS.put("ics_token:" + currentUid, tok);
        await env.TRIPS.put("ics_uid:" + tok, currentUid);
        if (currentUid === "usr_admin") {
          await env.TRIPS.put("ics_token", tok);
        }
      }
      return cors(json({ ok: true, url: url.origin + "/cal.ics?t=" + tok }));
    }
    // Safety net: weekly snapshots (taken Sundays before the daily sync) plus
    // the automatic pre-restore/pre-reset copy. List them / restore one.
    if (url.pathname === "/backups" && request.method === "GET") {
      if (currentUid !== "usr_admin") return cors(json({ error: "Snapshots are restricted to administrator" }, 403));
      const out = [];
      for (const slot of ["0", "1", "2", "3", "pre"]) {
        const raw = await env.TRIPS.get("backup:" + slot);
        if (!raw) continue;
        try { const b = JSON.parse(raw); const s = JSON.parse(b.raw);
          out.push({ slot, at: b.at, trips: Object.keys(s.trips || {}).length }); } catch (e) {}
      }
      out.sort((a, b) => b.at - a.at);
      return cors(json({ ok: true, backups: out }));
    }
    if (url.pathname === "/backups/restore" && request.method === "POST") {
      if (currentUid !== "usr_admin") return cors(json({ error: "Snapshots and restore are restricted to administrator" }, 403));
      const body = await request.json().catch(() => ({}));
      const raw = await env.TRIPS.get("backup:" + String(body.slot));
      if (!raw) return cors(json({ error: "no such snapshot" }, 404));
      const b = JSON.parse(raw);
      // keep what is being replaced, so a restore is itself restorable
      const cur = await env.TRIPS.get("store:usr_admin") || await env.TRIPS.get("store");
      if (cur) await env.TRIPS.put("backup:pre", JSON.stringify({ at: Date.now(), raw: cur }));
      await env.TRIPS.put("store", b.raw);
      await env.TRIPS.put("store:usr_admin", b.raw);
      const s = JSON.parse(b.raw);
      return cors(json({ ok: true, trips: Object.keys(s.trips || {}).length }));
    }
    // Manual trigger (handy while testing). Cron calls runSync on its own.
    // Awaited so the response means the sync actually finished and the store is
    // fresh. ?only=gmail runs a cheap email-only pass and the response carries
    // gmail stats {parsed,failed,filed,unfiled,remaining} so the app can keep
    // draining a backlog until remaining hits zero - no guessing.
    if (url.pathname === "/sync" && request.method === "POST") {
      if (currentUid !== "usr_admin") return cors(json({ error: "Google Calendar & Gmail sync is restricted to administrator" }, 403));
      const stats = await runSync(env, url.searchParams.get("only") || "");
      return cors(json(Object.assign({ ok: true }, stats)));
    }
    return new Response("Not found", { status: 404 });
  },

  async scheduled(event, env, ctx) {
    // 18:00 daily = the full sync (calendar + email + calendar write). The
    // hourly tick is the cheap email-only drain: it finishes what a closed
    // phone screen started and files fresh forwards within the hour. When
    // nothing new is waiting it costs ~4 subrequests and zero Claude tokens.
    const full = event.cron === "0 18 * * *";
    ctx.waitUntil((async () => {
      if (full) await maybeSnapshot(env);   // Sundays: keep a weekly copy BEFORE the day's sync touches anything
      await runSync(env, full ? "" : "gmail");
    })());
  },
};

// Every trip create/edit kicks a sync so the new trip is enriched from your
// calendar and inbox, but a burst of edits used to fire one full sync EACH. So
// per-edit syncs debounce: each save schedules the run 4s out and supersedes
// any earlier pending one, so mashing Save five times costs one sync cycle.
// (Isolate-local state - separate isolates can't coalesce, but one person
// editing hits one isolate.)
let editSyncGen = 0;
async function debouncedEditSync(env) {
  const gen = ++editSyncGen;
  await new Promise((r) => setTimeout(r, 4000));
  if (gen !== editSyncGen) return;   // a newer edit superseded this one
  try { await runSync(env); } catch (e) { console.error("edit sync", e); }
}

async function runSync(env, only) {
  const store = await loadStore(env);
  const stats = { gmail: null };
  const full = only !== "gmail";
  // Email runs BEFORE the calendar work. A Worker request has a hard cap on
  // outbound calls (~50 on the free plan) and a calendar-heavy sync used to
  // spend them all before a single email was parsed - forwarded bookings
  // silently never arrived. Bookings outrank calendar polish; and the app can
  // drain a big backlog with cheap /sync?only=gmail passes that skip the rest.
  // Email-only passes have the request almost to themselves, so they read 20
  // emails instead of 10 (2 calls each + overhead still fits the free cap).
  try { stats.gmail = await ingestFromGmail(store, env, full ? 10 : 20); } catch (e) { console.error("gmail", e); }
  if (full) {
    try { await ingestFromCalendar(store, env); } catch (e) { console.error("calendar", e); }
    try { await writeTripsToCalendar(store, env); } catch (e) { console.error("cal write", e); }
  }
  await saveStore(env, store);
  return stats;
}

/* ------------------------------- geocoder ------------------------------ */
function maskIcs(u) { u = (u || "").split("?")[0]; return u.length > 56 ? u.slice(0, 30) + "…" + u.slice(-18) : u; }
// Free geocoder (same one the app uses) to match a booking's city to the right
// trip even when the names differ (e.g. "Funchal" -> a "Madeira" trip).
async function geocodeName(name) {
  try {
    const r = await fetch("https://geocoding-api.open-meteo.com/v1/search?count=1&language=en&name=" + encodeURIComponent(name));
    if (r.ok) { const d = await r.json(); const g = (d.results || [])[0]; if (g) return { name: g.name, admin1: g.admin1, country: g.country }; }
  } catch (e) {}
  return null;
}

/* --------------------------- Calendar ingest --------------------------- */
// Reads Google Calendar events overlapping each trip and attaches them as segments.
// This is the cleanest source: the Booking.com / Airbnb items you already add to your calendar.

async function ingestFromCalendar(store, env) {
  const token = await googleToken(env);
  if (!token) return ingestFromICS(store, env);                // easy path: secret iCal address, no OAuth
  const calId = env.GOOGLE_CALENDAR_ID || "primary";
  for (const t of Object.values(store.trips)) {
    if (!t.start || !t.end) continue;
    const timeMin = new Date(t.start + "T00:00:00Z").toISOString();
    const timeMax = new Date(t.end + "T23:59:59Z").toISOString();
    const u = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events`
      + `?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}&singleEvents=true&orderBy=startTime`;
    const res = await fetch(u, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) continue;
    const data = await res.json();
    for (const ev of data.items || []) {
      if (ev.extendedProperties && ev.extendedProperties.private && ev.extendedProperties.private.travelSyncTrip) continue; // skip events we wrote
      const type = guessType(ev.summary || "");
      const hasGuests = (ev.attendees || []).length > 1;
      const timed = !!(ev.start && ev.start.dateTime);
      // travel-relevant only: bookings by type, anything with a place, or a real
      // timed invite with guests - never bare all-day agenda titles
      if (type === "other" && !ev.location && !(hasGuests && timed)) continue;
      const seg = {
        type,
        name: ev.summary || "Event",
        start: norm(ev.start && (ev.start.dateTime || ev.start.date)),
        end: norm(ev.end && (ev.end.dateTime || ev.end.date)),
        address: cleanLoc(ev.location),
        note: evNote(ev),
        conf: "gcal:" + ev.id,
        source: "calendar",
      };
      addSegment(t, seg, store);
    }
  }
}

// The no-OAuth path: the calendar's "Secret address in iCal format" pasted in
// Settings (Google Calendar -> your calendar -> Integrate calendar). Read-only,
// but Gmail auto-adds flights/hotels to the calendar, so most bookings arrive
// here anyway. Same segment mapping and dedupe keys as the API path above, so
// upgrading to full OAuth later never duplicates a segment.
async function ingestFromICS(store, env) {
  const icsUrl = (await env.TRIPS.get("g_ics")) || "";
  if (!icsUrl) return;
  const res = await fetch(icsUrl);
  if (!res.ok) return;
  const events = parseICS(await res.text());
  for (const t of Object.values(store.trips)) {
    if (!t.start || !t.end) continue;
    for (const ev of events) {
      if (!ev.start || ev.start > t.end || (ev.end || ev.start) < t.start) continue;
      if (/^Trip: /.test(ev.summary || "")) continue;          // our own write-back events
      const type = guessType(ev.summary || "");
      if (type === "other" && !ev.location && !(ev.att > 1 && ev.time)) continue; // agenda noise, not travel
      addSegment(t, {
        type,
        name: ev.summary || "Event",
        start: ev.start,
        end: ev.end || ev.start,
        note: [ev.time, cleanDesc(ev.desc).slice(0, 160)].filter(Boolean).join(" \u00b7 "),
        address: cleanLoc(ev.location),
        conf: "gcal:" + (ev.uid || "").replace(/@google\.com$/, ""),
        source: "calendar",
      }, store);
    }
  }
}
function parseICS(text) {
  const lines = text.replace(/\r/g, "").split("\n"), unfolded = [];
  for (const l of lines) {                                     // RFC 5545 line unfolding
    if ((l.startsWith(" ") || l.startsWith("\t")) && unfolded.length) unfolded[unfolded.length - 1] += l.slice(1);
    else unfolded.push(l);
  }
  const out = []; let ev = null;
  const day = (v) => { const m = v.match(/(\d{4})(\d{2})(\d{2})/); return m ? `${m[1]}-${m[2]}-${m[3]}` : ""; };
  const unesc = (s) => s.replace(/\\n/gi, " ").replace(/\\([,;\\])/g, "$1");
  for (const l of unfolded) {
    if (l === "BEGIN:VEVENT") { ev = {}; continue; }
    if (l === "END:VEVENT") { if (ev) out.push(ev); ev = null; continue; }
    if (!ev) continue;
    const i = l.indexOf(":"); if (i < 0) continue;
    const key = l.slice(0, i).split(";")[0], val = l.slice(i + 1);
    if (key === "UID") ev.uid = val;
    else if (key === "SUMMARY") ev.summary = unesc(val);
    else if (key === "LOCATION") ev.location = unesc(val);
    else if (key === "DESCRIPTION") ev.desc = unesc(val);
    else if (key === "ATTENDEE") ev.att = (ev.att || 0) + 1;
    else if (key === "DTSTART") { ev.start = day(val); const tm = val.match(/T(\d{2})(\d{2})/); if (tm) ev.time = tm[1] + ":" + tm[2]; }
    else if (key === "DTEND") ev.end = day(val);
  }
  return out;
}

// Normalise a city name for loose matching (lowercase, strip accents).
function normCity(s) {
  return (s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
}

/* ----------------------------- Gmail ingest ---------------------------- */
// For confirmations that only land in email (drivers, transfers). Claude does the extraction.
// SWAP TO TRIPIT: if you would rather not maintain extraction, replace this whole function with a
// single GET https://api.tripit.com/v1/list/object/traveler/true/format/json (OAuth) and map the
// air/lodging/car objects into segments. Same downstream code.

// One year of lookback, multilingual keywords, and the common booking senders.
// Shared by the ingest and by /google/test's match count.
const GMAIL_TERMS = 'from:booking.com OR from:airbnb.com OR from:hotels.com OR from:expedia.com '
  + 'OR from:agoda.com OR from:trip.com OR from:uber.com OR from:bolt.eu '
  + 'OR subject:(confirmation OR itinerary OR reservation OR booking OR hotel OR "check-in" '
  + 'OR reserva OR confirmacao OR "confirma\u00e7\u00e3o" OR boeking OR bevestiging OR reservering OR pickup)';
// Forward-to-ingest: anything sent to you+trip@your-address is always picked
// up, whatever the sender or subject - forward a confirmation to yourself
// with "+trip" added before the @ and the next sync files it.
async function gmailQuery(env, token) {
  let plus = "";
  try {
    const r = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", { headers: { Authorization: `Bearer ${token}` } });
    if (r.ok) {
      const em = ((await r.json()).emailAddress || "");
      if (em.includes("@")) { plus = em.replace("@", "+trip@"); await env.TRIPS.put("g_email", em); }
    }
  } catch (e) {}
  if (!plus) {   // profile call hiccuped: fall back to the cached address so +trip forwards are NEVER dropped from the search
    const em = (await env.TRIPS.get("g_email")) || "";
    if (em.includes("@")) plus = em.replace("@", "+trip@");
  }
  return "newer_than:1y (" + GMAIL_TERMS + (plus ? " OR to:" + plus : "") + ")";
}

// Returns honest stats so the caller can SEE what happened instead of
// guessing: parsed / failed (parser unreachable, will retry) / filed into
// trips / unfiled (no trip covers the dates) / remaining (matching emails
// still unread - the app keeps running passes until this is 0).
async function ingestFromGmail(store, env, maxEmails) {
  const out = { parsed: 0, failed: 0, filed: 0, unfiled: 0, remaining: 0 };
  const token = await googleToken(env);
  if (!token) return out;                                      // Google not connected yet
  // Page through matches (newest first) so older bookings are reachable even
  // when newer emails also match - the old top-25 window could never get past
  // them. Cap per-page and total to stay inside Workers subrequest limits.
  const q = await gmailQuery(env, token);
  let ids = [], pageToken = "";
  for (let page = 0; page < 2 && ids.length < 200; page++) {
    const listRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=100&q=${encodeURIComponent(q)}`
        + (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""),
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!listRes.ok) return out;
    const list = await listRes.json();
    ids = ids.concat((list.messages || []).map((m) => m.id));
    pageToken = list.nextPageToken;
    if (!pageToken) break;
  }
  store.seenEmails = store.seenEmails || {};
  let budget = maxEmails || 10;   // new emails parsed per sync; the rest drain on later syncs (keeps total fetches inside Workers limits)
  for (const id of ids) {
    if (store.seenEmails[id]) continue;
    if (budget-- <= 0) break;
    const gm = await gmailMessage(token, id);
    if (!gm.text) { store.seenEmails[id] = 1; continue; }
    const segs = await extractSegments(env, gm.text, gm.plus);
    if (segs === undefined) { out.failed++; continue; }   // extractor unavailable (no key / API down): leave unseen so a later sync retries
    store.seenEmails[id] = 1;
    out.parsed++;
    // Hotels first, so a stay can create its trip and the flights/transfers in
    // the same email file straight into it instead of landing in "unfiled".
    segs.sort((a, b) => (b.type === "hotel" ? 1 : 0) - (a.type === "hotel" ? 1 : 0));
    const pending = [], dateless = [];
    let n = 0;
    for (const seg of segs) {
      seg.source = "gmail";
      if (!seg.conf) seg.conf = "mail:" + id + ":" + (n++);   // dedupe key even when no confirmation number exists
      const city = seg.city || ""; delete seg.city;   // trip-level info, not part of the segment shape
      if (!seg.start) { if (gm.plus) dateless.push({ seg, city }); continue; }
      const trip = await findTripForSeg(store, seg, city);
      if (trip) { addSegment(trip, seg, store); out.filed++; }
      else if (seg.type === "hotel" && seg.end && seg.end > seg.start) {
        // A hotel stay with no covering trip IS a trip. Parking it in
        // "unfiled" purgatory was why forwarded bookings kept "never
        // arriving" - now the stay creates the trip itself (destination =
        // the hotel's city, dates = the stay) and syncs onward like any
        // hand-made trip (calendar block).
        const tid = uid();
        store.trips[tid] = { id: tid, from: "", to: city || seg.name || "Trip",
          start: seg.start, end: seg.end, label: "", notes: "", segments: [], updatedAt: Date.now() };
        addSegment(store.trips[tid], seg, store);
        out.filed++; out.tripsCreated = (out.tripsCreated || 0) + 1;
      } else pending.push({ seg, city });
    }
    // A forwarded return ticket IS a trip too: two or more uncovered flights in
    // one email span the trip, outbound arrival city is the destination.
    const legs = pending.filter((p) => p.seg.type === "flight");
    if (legs.length >= 2) {
      legs.sort((a, b) => (a.seg.start < b.seg.start ? -1 : 1));
      const tid = uid();
      store.trips[tid] = { id: tid, from: "", to: legs[0].city || legs[0].seg.name || "Trip",
        start: legs[0].seg.start, end: legs.map((p) => p.seg.end || p.seg.start).sort().pop(),
        label: "", notes: "", segments: [], updatedAt: Date.now() };
      for (const p of legs) { addSegment(store.trips[tid], p.seg, store); out.filed++; }
      out.tripsCreated = (out.tripsCreated || 0) + 1;
    }
    for (const p of pending.filter((x) => !(legs.length >= 2 && x.seg.type === "flight"))) {
      // parsed fine but no trip covers the date - keep a visible trace so
      // "why isn't my hotel showing" is answerable from Test connection
      store.unfiled = (store.unfiled || []).slice(-19);
      store.unfiled.push({ name: p.seg.name || "Booking", start: p.seg.start, end: p.seg.end || "" });
      out.unfiled++;
    }
    // Deliberate forwards without dates (a hotel's chat message, a note): file
    // by destination so the info still lands inside the right trip.
    for (const p of dateless) {
      const trip = await findTripByCity(store, p.city || p.seg.name);
      if (trip) { p.seg.start = trip.start; addSegment(trip, p.seg, store); out.filed++; }
      else { store.unfiled = (store.unfiled || []).slice(-19); store.unfiled.push({ name: p.seg.name || "Forwarded note", start: "", end: "" }); out.unfiled++; }
    }
  }
  out.remaining = ids.filter((id) => !store.seenEmails[id]).length;
  return out;
}

// Universal LLM Config: supports Anthropic and any OpenAI-compatible base URL (Gemini, Groq, OpenAI, DeepSeek, etc.)
async function getLLMConfig(env, uid = "usr_admin") {
  // If specific tenant, check user:<uid>:llm_config first
  let userKvConfig = null;
  if (uid && uid !== "usr_admin") {
    try {
      const raw = await env.TRIPS.get("user:" + uid + ":llm_config");
      if (raw) userKvConfig = JSON.parse(raw);
    } catch(e) {}

    if (userKvConfig && userKvConfig.apiKey) {
      let provider = userKvConfig.provider || "openai";
      let baseUrl = userKvConfig.baseUrl || "";
      let model = userKvConfig.model || "";
      let fallbackModel = userKvConfig.fallbackModel || "";
      let apiKey = userKvConfig.apiKey;

      if (!baseUrl && provider !== "anthropic") {
        if (provider === "gemini") baseUrl = "https://generativelanguage.googleapis.com/v1beta/openai";
        else if (provider === "groq") baseUrl = "https://api.groq.com/openai/v1";
        else if (provider === "deepseek") baseUrl = "https://api.deepseek.com/v1";
        else if (provider === "openai") baseUrl = "https://api.openai.com/v1";
      }
      if (!model) {
        if (provider === "anthropic") model = "claude-3-5-haiku-latest";
        else if (provider === "gemini") model = "gemini-2.0-flash";
        else if (provider === "groq") model = "qwen/qwen3.8-27b";
        else if (provider === "deepseek") model = "deepseek-chat";
        else model = "gpt-4o";
      }
      return {
        provider,
        baseUrl,
        apiKey,
        model,
        fallbackModel,
        source: "tenant"
      };
    }

    // Tenant has not configured their own key: check if shared_ai_pool is enabled in system:config
    const sysCfg = await getSystemConfig(env);
    if (!sysCfg.shared_ai_pool) {
      return {
        provider: "none",
        baseUrl: "",
        apiKey: "",
        model: "",
        fallbackModel: "",
        source: "none",
        byokRequired: true
      };
    }
  }

  if (env._llmConfig && env._llmConfigTs && (Date.now() - env._llmConfigTs < 15000)) return env._llmConfig;
  let kvConfig = null;
  try {
    const raw = await env.TRIPS.get("llm_config");
    if (raw) kvConfig = JSON.parse(raw);
  } catch (e) {}

  const envApiKey = env.LLM_API_KEY || env.ANTHROPIC_API_KEY || env.OPENAI_API_KEY || "";
  const envBaseUrl = env.LLM_BASE_URL || "";
  const envModel = env.LLM_MODEL || "";
  const envFallbackModel = env.LLM_FALLBACK_MODEL || "";
  const envProvider = env.LLM_PROVIDER || "";

  let apiKey = envApiKey || (kvConfig && kvConfig.apiKey) || (await env.TRIPS.get("anthropic_key")) || "";
  let baseUrl = envBaseUrl || (kvConfig && kvConfig.baseUrl) || "";
  let model = envModel || (kvConfig && kvConfig.model) || "";
  let fallbackModel = envFallbackModel || (kvConfig && kvConfig.fallbackModel) || "";
  let provider = envProvider || (kvConfig && kvConfig.provider) || "";

  // Infer provider if not specified
  if (!provider) {
    if (baseUrl.includes("generativelanguage.googleapis.com")) provider = "gemini";
    else if (baseUrl.includes("api.groq.com")) provider = "groq";
    else if (baseUrl.includes("api.deepseek.com")) provider = "deepseek";
    else if (apiKey.startsWith("sk-ant-") && !baseUrl) provider = "anthropic";
    else if (baseUrl || apiKey.startsWith("sk-")) provider = "openai";
    else provider = "anthropic";
  }

  // Sensible default primary models if user did not specify one
  if (!model) {
    if (provider === "anthropic") model = "claude-3-5-haiku-latest";
    else if (provider === "gemini") model = "gemini-2.0-flash";
    else if (provider === "groq") model = "qwen/qwen3.8-27b";
    else if (provider === "deepseek") model = "deepseek-chat";
    else model = "gpt-4o";
  }

  // Sensible default fallback model if user did not specify one
  if (!fallbackModel) {
    if (provider === "groq") fallbackModel = "openai/gpt-oss-120b";
    else if (provider === "gemini") fallbackModel = "gemini-1.5-flash";
    else if (provider === "openai") fallbackModel = "gpt-4o-mini";
    else if (provider === "anthropic") fallbackModel = "claude-3-5-haiku-latest";
  }

  // Default OpenAI-compatible base URLs
  if (!baseUrl && provider !== "anthropic") {
    if (provider === "gemini") baseUrl = "https://generativelanguage.googleapis.com/v1beta/openai";
    else if (provider === "groq") baseUrl = "https://api.groq.com/openai/v1";
    else if (provider === "deepseek") baseUrl = "https://api.deepseek.com/v1";
    else if (provider === "openai") baseUrl = "https://api.openai.com/v1";
  }

  const source = (envApiKey || envBaseUrl || envModel || envFallbackModel) ? "secret" : (kvConfig || await env.TRIPS.get("anthropic_key")) ? "in-app" : "none";

  env._llmConfigTs = Date.now();
  return (env._llmConfig = { provider, baseUrl, apiKey, model, fallbackModel, source });
}

// Backward compatible alias
async function anthropicKey(env) {
  const llm = await getLLMConfig(env);
  return llm.apiKey;
}

// Resend Configuration and Sending Helper
async function getResendConfig(env) {
  if (env._resendConfig) return env._resendConfig;
  let kvConfig = null;
  try {
    const raw = await env.TRIPS.get("resend_config");
    if (raw) kvConfig = JSON.parse(raw);
  } catch (e) {}

  const apiKey = env.RESEND_API_KEY || (kvConfig && kvConfig.apiKey) || (await env.TRIPS.get("resend_key")) || "";
  const from = env.RESEND_FROM || (kvConfig && kvConfig.from) || (await env.TRIPS.get("resend_from")) || "888travel <onboarding@resend.dev>";
  const source = env.RESEND_API_KEY ? "secret" : (apiKey ? "in-app" : "none");

  return (env._resendConfig = { apiKey, from, source });
}

async function getResendKey(env) {
  const cfg = await getResendConfig(env);
  return cfg.apiKey;
}

function maskEmail(e) {
  if (!e || !e.includes("@")) return e || "";
  const parts = e.split("@");
  const name = parts[0];
  const dom = parts[1];
  const maskedName = name.length <= 2 ? name[0] + "***" : name.slice(0, 2) + "***" + name.slice(-1);
  return maskedName + "@" + dom;
}

async function sendEmailViaResend(env, { to, subject, html, text }) {
  const cfg = await getResendConfig(env);
  if (!cfg.apiKey) throw new Error("Resend API key not configured");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${cfg.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: cfg.from,
      to: Array.isArray(to) ? to : [to],
      subject,
      html,
      text: text || "",
    }),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Resend API error (${res.status}): ${errText}`);
  }
  return await res.json();
}

// Google Places API Configuration
async function getGooglePlacesConfig(env) {
  if (env._placesConfig) return env._placesConfig;
  const envKey = (env.GOOGLE_PLACES_API_KEY || "").trim();
  const kvKey = ((await env.TRIPS.get("google_places_key")) || "").trim();
  const apiKey = envKey || kvKey;
  const source = envKey ? "secret" : (kvKey ? "in-app" : "none");
  return (env._placesConfig = { apiKey, source, configured: Boolean(apiKey) });
}

async function searchGooglePlaces(env, query, lang = "zh-TW") {
  const places = await getGooglePlacesConfig(env);
  if (!places.apiKey) {
    return { ok: false, status: 400, error: "Google Places API 尚未設定 / Google Places API not configured" };
  }
  const q = (query || "").trim();
  if (!q) return { ok: false, status: 400, error: "搜尋關鍵字為必填 / Search query required" };

  try {
    const searchUrl = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(q)}&key=${places.apiKey}&language=${encodeURIComponent(lang)}`;
    const res = await fetch(searchUrl);
    if (!res.ok) {
      return { ok: false, status: res.status, error: `Google Places API 查詢失敗 (${res.status})` };
    }
    const data = await res.json();
    if (data.status === "REQUEST_DENIED") {
      return { ok: false, status: 403, error: `Google Places API 授權失敗: ${data.error_message || "API Key 無效或未開通 Places API"}` };
    }
    if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
      return { ok: false, status: 400, error: `Google Places API 異常: ${data.status} - ${data.error_message || ""}` };
    }

    const results = (data.results || []).slice(0, 5).map(p => ({
      placeId: p.place_id,
      name: p.name,
      address: p.formatted_address,
      rating: p.rating || null,
      userRatingsTotal: p.user_ratings_total || null,
      priceLevel: p.price_level !== undefined ? p.price_level : null,
      openNow: p.opening_hours ? p.opening_hours.open_now : null,
      types: p.types || [],
      mapsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.name)}&query_place_id=${p.place_id}`
    }));

    return { ok: true, results };
  } catch (err) {
    return { ok: false, status: 500, error: "連線至 Google Places 失敗: " + (err.message || String(err)) };
  }
}

async function getGooglePlaceDetails(env, placeId, lang = "zh-TW") {
  const places = await getGooglePlacesConfig(env);
  if (!places.apiKey) return { ok: false, status: 400, error: "Google Places API not configured" };
  const pid = (placeId || "").trim();
  if (!pid) return { ok: false, status: 400, error: "placeId required" };

  try {
    const detailUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${encodeURIComponent(pid)}&fields=name,formatted_address,rating,user_ratings_total,opening_hours,formatted_phone_number,website,url,price_level&key=${places.apiKey}&language=${encodeURIComponent(lang)}`;
    const res = await fetch(detailUrl);
    const data = await res.json();
    if (data.status !== "OK") {
      return { ok: false, status: 400, error: data.error_message || data.status };
    }
    const r = data.result || {};
    return {
      ok: true,
      place: {
        placeId: pid,
        name: r.name,
        address: r.formatted_address,
        rating: r.rating || null,
        userRatingsTotal: r.user_ratings_total || null,
        priceLevel: r.price_level,
        openNow: r.opening_hours ? r.opening_hours.open_now : null,
        weekdayText: r.opening_hours ? r.opening_hours.weekday_text : null,
        phone: r.formatted_phone_number || null,
        website: r.website || null,
        mapsUrl: r.url || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(r.name)}&query_place_id=${pid}`
      }
    };
  } catch (err) {
    return { ok: false, status: 500, error: "Details fetch failed: " + (err.message || String(err)) };
  }
}

async function dispatchAiChat(env, rawMessages, currentTripId = "", uid = "usr_admin") {
  const windowMessages = (Array.isArray(rawMessages) ? rawMessages : []).slice(-10);
  const messages = windowMessages
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .map((m) => ({ role: m.role, content: m.content.trim() }));

  if (messages.length === 0) {
    return { ok: false, status: 400, error: "INVALID_REQUEST", message: "對話訊息不可為空 / Messages cannot be empty" };
  }

  const llm = await getLLMConfig(env, uid);
  if (llm.byokRequired || !llm.apiKey) {
    return {
      ok: false,
      status: 400,
      error: "NO_LLM_KEY",
      message: llm.byokRequired
        ? "為保護系統資源，新用戶需使用自有金鑰 (BYOK)。請前往「系統設定 ⚙️ ➔ AI 模型」配置您的專屬 API Key 後即可開始使用！"
        : "尚未設定 AI 語言模型金鑰，請前往「設定」配置 API Key。"
    };
  }

  const store = await loadStore(env, uid);
  const tripId = (currentTripId || "").trim();
  let tripContext = "";
  let activeTrip = null;

  if (tripId && store.trips[tripId]) {
    activeTrip = store.trips[tripId];

    // Clean and slim notes so giant URL dumps do not consume thousands of tokens
    let rawNotes = activeTrip.notes || "";
    let cleanNotes = rawNotes.replace(/https?:\/\/\S+/g, "").replace(/資料來源[：:]/g, "").replace(/\n{2,}/g, "\n").trim();
    if (cleanNotes.length > 350) {
      cleanNotes = cleanNotes.slice(0, 350) + "… (後續略)";
    }

    const segSummary = (activeTrip.segments || [])
      .slice()
      .sort((a, b) => ((a.start || "") < (b.start || "") ? -1 : 1))
      .slice(0, 20)
      .map((s) => {
        let line = `[${s.start || "未定時間"}] ${s.type || "other"}: ${s.name || "未命名"}`;
        if (s.address) line += ` [地點: ${s.address.slice(0, 30)}]`;
        if (s.note) line += ` (${s.note.slice(0, 40)})`;
        if (s.fallback && s.fallback.name) line += ` [備案: ${s.fallback.name}]`;
        return line;
      })
      .join("\n");

    tripContext = `【目前討論中的行程 (Active Trip Context)】
- 行程 ID: ${activeTrip.id}
- 行程名稱: ${activeTrip.label || activeTrip.to}
- 目的地: ${activeTrip.to} (出發地: ${activeTrip.from || "未指定"})
- 日期區間: ${activeTrip.start} 至 ${activeTrip.end}
- 時區: ${activeTrip.timezone || "未設定"}
- 概述/備註: ${cleanNotes || "無"}
- 目前已安排細項 (${(activeTrip.segments || []).length} 項):
${segSummary || "（目前尚無細項安排）"}`;
  } else {
    const upcoming = Object.values(store.trips)
      .slice()
      .sort((a, b) => ((a.start || "") < (b.start || "") ? -1 : 1))
      .slice(0, 8)
      .map((t) => `- [${t.id}] ${t.label || t.to} (${t.from || ""} ➔ ${t.to}) : ${t.start} ~ ${t.end} [${(t.segments || []).length} 項細項]`)
      .join("\n");
    tripContext = `【旅客目前行程清單總覽 (All Trips Overview)】
${upcoming || "（目前尚未建立任何行程）"}`;
  }

  const sysPrompt = `你是一位專業、敏銳且細緻的個人旅遊規劃特助 (888travel Copilot)。
你的任務是協助旅客構思、討論與優化行程規劃（包含餐廳美食、飯店住宿、航班、鐵路、交通接駁、景點活動與雨天/客滿備案）。

${tripContext}

【原則與行為指引】
1. 回應親切自然、條理分明、具備專業旅遊洞察。建議應考慮當地的地理距離、營業時間、動線流暢度與時差/交通。
2. 支援 7 種細項規劃類別:
   - flight (✈️ 航班)
   - hotel (🏨 飯店住宿)
   - restaurant (🍽️ 餐廳美食)
   - rail (🚆 鐵路/新幹線/地鐵)
   - car (🚗 租車自駕)
   - ride (🚕 計程車/機場接送)
   - other (📍 景點活動/展覽/會議)
3. 當你在對話中建議「具體的行程項目、餐廳預約、景點活動或交通」時，除了親切回應用戶外，請務必在回應結尾附上結構化提案區塊 (proposal block)。格式嚴格遵循：
:::proposal
{
  "action": "add_segments",
  "tripId": "${activeTrip ? activeTrip.id : ""}",
  "segments": [
    {
      "type": "restaurant",
      "name": "餐廳或景點名稱",
      "address": "地址或概略位置",
      "start": "YYYY-MM-DDTHH:mm:ss 或 YYYY-MM-DD",
      "end": "YYYY-MM-DDTHH:mm:ss 或 YYYY-MM-DD (選填)",
      "note": "簡短精闢的推薦理由或用餐/參觀重點",
      "fallback": {
        "name": "備案名稱 (例如客滿或雨天替代方案)",
        "address": "備案地址 (選填)",
        "note": "備案說明 (選填)"
      }
    }
  ]
}
:::
4. 如果旅客只是閒聊、問一般天氣、問建議、或無具體要排入行程的項目，請正常文字回應，不要輸出 :::proposal 區塊。
5. 每次 proposal 的 segments 請控制在 1 ~ 4 個精選項目以內，質量重於數量。
6. 對於熱門餐廳或戶外行程，強烈建議主動規劃可行的 fallback (備案方案)。
7. proposal 內的 JSON 必須是標準 JSON，請勿包含尾隨逗號或註解。`;

  function isDegeneratedRepetition(text) {
    if (!text || text.length < 100) return false;
    const norm = text.replace(/\s+/g, " ");
    const match = norm.match(/(.{8,80}?)\s*\1\s*\1\s*\1/);
    return Boolean(match);
  }

  async function callModel(targetModel) {
    if (!targetModel) return { ok: false, status: 400, error: "NO_MODEL", message: "未指定模型" };
    try {
      if (llm.provider === "anthropic" || (!llm.baseUrl && llm.apiKey.startsWith("sk-ant-"))) {
        const anthropicMsgs = [];
        for (const m of messages) {
          if (anthropicMsgs.length === 0 && m.role !== "user") continue;
          if (anthropicMsgs.length > 0 && anthropicMsgs[anthropicMsgs.length - 1].role === m.role) {
            anthropicMsgs[anthropicMsgs.length - 1].content += "\n\n" + m.content;
          } else {
            anthropicMsgs.push({ role: m.role, content: m.content });
          }
        }
        if (anthropicMsgs.length === 0) anthropicMsgs.push({ role: "user", content: "你好" });

        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "x-api-key": llm.apiKey,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json"
          },
          body: JSON.stringify({
            model: targetModel,
            max_tokens: 2500,
            system: sysPrompt,
            messages: anthropicMsgs
          })
        });

        if (!res.ok) {
          const errText = await res.text().catch(() => "");
          if (res.status === 429) return { ok: false, status: 429, error: "RATE_LIMITED", message: `AI 服務達到速率限制 (429) [${targetModel}]` };
          return { ok: false, status: res.status, error: "PROVIDER_ERROR", message: `Anthropic API 錯誤 (${res.status}) [${targetModel}]: ${errText.slice(0, 200)}` };
        }

        const data = await res.json();
        const replyText = (data.content || []).filter((c) => c.type === "text").map((c) => c.text).join("").trim();
        if (!replyText) {
          return { ok: false, status: 500, error: "EMPTY_REPLY", message: `模型 (${targetModel}) 未回傳文字內容` };
        }
        if (isDegeneratedRepetition(replyText)) {
          return { ok: false, status: 500, error: "REPETITION_DEGENERATION", message: `模型 (${targetModel}) 陷入重複迴圈退化` };
        }
        return { ok: true, replyText, model: targetModel };
      } else {
        const baseUrl = (llm.baseUrl || "https://api.openai.com/v1").replace(/\/+$/, "");
        const endpoint = baseUrl.endsWith("/chat/completions") ? baseUrl : `${baseUrl}/chat/completions`;
        const openAiMsgs = [{ role: "system", content: sysPrompt }, ...messages];

        const res = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${llm.apiKey}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            model: targetModel,
            temperature: 0.4,
            max_tokens: 3500,
            messages: openAiMsgs
          })
        });

        if (!res.ok) {
          const errText = await res.text().catch(() => "");
          if (res.status === 429) return { ok: false, status: 429, error: "RATE_LIMITED", message: `AI 服務達到速率限制 (429) [${targetModel}]` };
          return { ok: false, status: res.status, error: "PROVIDER_ERROR", message: `AI 服務錯誤 (${res.status}) [${targetModel}]: ${errText.slice(0, 200)}` };
        }

        const data = await res.json();
        const choice = data.choices && data.choices[0];
        const replyText = ((choice && choice.message && choice.message.content) || "").trim();

        if (!replyText && choice) {
          if (choice.finish_reason === "length" || (choice.message && choice.message.reasoning && !choice.message.content)) {
            return {
              ok: false,
              status: 400,
              error: "REASONING_TOKEN_LIMIT",
              message: `模型 (${targetModel}) 思考迴圈過長超出 Token 上限，未能產出內容`
            };
          }
          return {
            ok: false,
            status: 500,
            error: "EMPTY_REPLY",
            message: `模型 (${targetModel}) 未產生回覆內容`
          };
        }
        if (!replyText) {
          return { ok: false, status: 500, error: "EMPTY_REPLY", message: `模型 (${targetModel}) 回傳空字串` };
        }
        if (isDegeneratedRepetition(replyText)) {
          return {
            ok: false,
            status: 500,
            error: "REPETITION_DEGENERATION",
            message: `模型 (${targetModel}) 陷入重複迴圈退化`
          };
        }
        return { ok: true, replyText, model: targetModel };
      }
    } catch (err) {
      console.error(`AI chat error for ${targetModel}:`, err);
      return { ok: false, status: 500, error: "NETWORK_ERROR", message: `連線失敗 [${targetModel}]: ${err && err.message ? err.message : String(err)}` };
    }
  }

  const primaryModel = llm.model || (llm.provider === "groq" ? "qwen/qwen3.8-27b" : "gpt-4o");
  const fallbackModel = (llm.fallbackModel || "").trim();

  let primaryRes = await callModel(primaryModel);

  if (primaryRes.ok) {
    return {
      ok: true,
      reply: primaryRes.replyText,
      provider: llm.provider,
      model: primaryModel,
      fallbackUsed: false
    };
  }

  // Primary model failed. Check if fallback model is configured and different from primary
  if (fallbackModel && fallbackModel !== primaryModel) {
    console.warn(`[dispatchAiChat] Primary model '${primaryModel}' failed (${primaryRes.error}: ${primaryRes.message}). Attempting automatic fallback to '${fallbackModel}'...`);
    const fallbackRes = await callModel(fallbackModel);
    if (fallbackRes.ok) {
      console.log(`[dispatchAiChat] Successfully recovered via fallback model '${fallbackModel}'`);
      return {
        ok: true,
        reply: fallbackRes.replyText,
        provider: llm.provider,
        model: fallbackModel,
        primaryModel: primaryModel,
        fallbackUsed: true
      };
    }
    // Both failed
    console.error(`[dispatchAiChat] Fallback model '${fallbackModel}' also failed (${fallbackRes.error}: ${fallbackRes.message})`);
    return {
      ok: false,
      status: fallbackRes.status || primaryRes.status || 500,
      error: fallbackRes.error || primaryRes.error || "ALL_MODELS_FAILED",
      message: `主要模型 (${primaryModel}) 與備援模型 (${fallbackModel}) 均呼叫失敗：${primaryRes.message}；備援原因：${fallbackRes.message}`
    };
  }

  // No fallback model available, return primary failure
  return {
    ok: false,
    status: primaryRes.status || 500,
    error: primaryRes.error || "PROVIDER_ERROR",
    message: primaryRes.message || "連線 AI 服務失敗"
  };
}

// Returns an ARRAY of segment objects (a return ticket = one per flight, so
// nothing in the email is lost; empty = "this email is not a booking"), or
// undefined ("could not ask" - no key / API down; caller retries later).
async function extractSegments(env, emailText, deliberate) {
  const llm = await getLLMConfig(env);
  if (!llm.apiKey) return undefined;

  const sysInstruction = "You are an expert travel booking confirmation extractor. From the travel email provided, extract booking details and return ONLY a valid JSON array of objects conforming to this schema:\n"
    + '[{"type":"flight|hotel|car|ride|rail|restaurant|other","name":"","city":"","start":"YYYY-MM-DD","end":"YYYY-MM-DD","address":"","conf":"","note":""}].\n'
    + "Rules:\n"
    + "- Return ONLY the raw JSON array. Never wrap in markdown codeblocks (no ```json). No introductory or concluding text.\n"
    + "- One object per bookable item: a return ticket = one object per flight (outbound AND return), a hotel stay = ONE object for the whole stay. Max 5 objects.\n"
    + "- city = the destination city of the booking (for a flight: the arrival city).\n"
    + '- note = the ONE line a traveller needs at a glance: flights -> flight number, route and times incl. layovers (e.g. "TP1479 OPO-LIS 07:10 · LIS-GIG 09:55"); '
    + "hotels -> check-in time and any door/PIN/keyless entry code; transfers -> pickup time, meeting point, driver name/phone; restaurants/meetings -> time and who/what.\n"
    + (deliberate
      ? "- The traveller forwarded this email ON PURPOSE to file it into their travel app. Even if it is not a standard confirmation (a message from a hotel, an itinerary, a reminder), return one object with everything known: the venue/hotel name, city, any dates, and the useful details in note. Leave start/end empty rather than guessing. Return [] only if there is truly nothing travel-related.\n"
      : "- If it is not a real booking, return [].\n");

  const userPrompt = "Here is the email content to parse:\n\n" + emailText.slice(0, 8000);

  const primaryModel = llm.model || (llm.provider === "anthropic" ? "claude-haiku-4-5" : (llm.provider === "groq" ? "qwen/qwen3.8-27b" : "gpt-4o"));
  const fallbackModel = (llm.fallbackModel || "").trim();

  async function requestExtraction(targetModel) {
    if (!targetModel) return undefined;
    try {
      if (llm.provider === "anthropic" || (!llm.baseUrl && llm.apiKey.startsWith("sk-ant-"))) {
        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "x-api-key": llm.apiKey,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json"
          },
          body: JSON.stringify({
            model: targetModel,
            max_tokens: 1000,
            messages: [{ role: "user", content: sysInstruction + "\n\n" + userPrompt }]
          })
        });
        if (!res.ok) {
          const errText = await res.text().catch(() => "");
          console.error(`LLM Anthropic error (${res.status}) [${targetModel}]:`, errText);
          return undefined;
        }
        const data = await res.json();
        return (data.content || []).filter((c) => c.type === "text").map((c) => c.text).join("").trim();
      } else {
        // OpenAI-compatible (Gemini via OpenAI-compat URL, Groq, OpenAI, DeepSeek, LocalAI, Ollama, etc.)
        const baseUrl = (llm.baseUrl || "https://api.openai.com/v1").replace(/\/+$/, "");
        const endpoint = baseUrl.endsWith("/chat/completions") ? baseUrl : `${baseUrl}/chat/completions`;
        const res = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${llm.apiKey}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            model: targetModel,
            temperature: 0.1,
            messages: [
              { role: "system", content: sysInstruction },
              { role: "user", content: userPrompt }
            ]
          })
        });
        if (!res.ok) {
          const errText = await res.text().catch(() => "");
          console.error(`LLM OpenAI-compat error (${res.status}) [${targetModel}]:`, errText);
          return undefined;
        }
        const data = await res.json();
        return ((data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || "").trim();
      }
    } catch (e) {
      console.error(`LLM execution error [${targetModel}]:`, e);
      return undefined;
    }
  }

  let rawContent = await requestExtraction(primaryModel);
  if ((rawContent === undefined || !rawContent) && fallbackModel && fallbackModel !== primaryModel) {
    console.warn(`[extractSegments] Primary model '${primaryModel}' failed or returned empty. Trying fallback model '${fallbackModel}'...`);
    rawContent = await requestExtraction(fallbackModel);
  }

  if (!rawContent) return [];

  let parsed;
  try {
    const cleaned = rawContent.replace(/```json\s*|```\s*/gi, "").trim();
    parsed = JSON.parse(cleaned);
  } catch (_) {
    const match = rawContent.match(/\[\s*\{[\s\S]*\}\s*\]/);
    if (match) {
      try { parsed = JSON.parse(match[0]); } catch (e) { return []; }
    } else {
      return [];
    }
  }

  const list = (Array.isArray(parsed) ? parsed : parsed ? [parsed] : []).filter((o) => o && typeof o === "object");
  const dup = {};
  for (const o of list) {
    o.start = norm(o.start);
    o.end = norm(o.end);
    if (o.conf) {
      if (dup[o.conf]) o.conf = o.conf + "#" + (++dup[o.conf]);
      else dup[o.conf] = 1;
    }
  }
  return list;
}

/* --------------------------- Calendar write ---------------------------- */
// One tidy "Trip: X" event per trip, so the trip shows up on your calendar as a single block.

async function writeTripsToCalendar(store, env) {
  const token = await googleToken(env);
  if (!token) return;                                          // Google not connected yet
  const calId = env.GOOGLE_CALENDAR_ID || "primary";
  for (const t of Object.values(store.trips)) {
    if (!isDate(t.start) || !isDate(t.end)) continue;   // never hand Google (or addDay) a garbage date
    const body = {
      summary: `Trip: ${t.label || (t.to || "Travel")}`,
      start: { date: t.start },
      end: { date: addDay(t.end) }, // all-day end is exclusive
      description: (t.segments || []).map((s) => `${s.type}: ${s.name}`).join("\n"),
      extendedProperties: { private: { travelSyncTrip: t.id } },
    };
    const method = t.calEventId ? "PATCH" : "POST";
    const u = t.calEventId
      ? `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events/${t.calEventId}`
      : `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events`;
    const res = await fetch(u, {
      method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    if (res.ok) { const ev = await res.json(); t.calEventId = ev.id; }
  }
}

/* ----------------------------- Calendly (optional) --------------------- */
// If you meant Calendly rather than Google Calendar, finish this and call it inside runSync.
// async function ingestFromCalendly(store, env) {
//   const res = await fetch("https://api.calendly.com/scheduled_events?user=YOUR_USER_URI",
//     { headers: { Authorization: `Bearer ${env.CALENDLY_TOKEN}` } });
//   const data = await res.json();
//   for (const ev of data.collection || []) { /* map ev to a segment, addSegment(trip, seg) */ }
// }

/* ------------------------------- helpers ------------------------------- */
// OAuth client: dashboard secrets win, else the pair saved in-app (KV).
async function googleClient(env) {
  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) return { id: env.GOOGLE_CLIENT_ID, secret: env.GOOGLE_CLIENT_SECRET };
  try {
    const kv = JSON.parse((await env.TRIPS.get("g_client")) || "null");
    if (kv && kv.id && kv.secret) return kv;
  } catch (e) {}
  return null;
}
async function googleToken(env) {
  if (env._gtok !== undefined) return env._gtok;               // one refresh per invocation
  const c = await googleClient(env);
  const refresh = env.GOOGLE_REFRESH_TOKEN || (await env.TRIPS.get("g_refresh")) || "";
  if (!c || !refresh) return (env._gtok = null);               // not connected: ingest steps no-op
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: c.id, client_secret: c.secret,
      refresh_token: refresh, grant_type: "refresh_token",
    }),
  });
  const d = await res.json();
  return (env._gtok = d.access_token || null);
}

// Fetch one email: readable text PLUS whether it was deliberately sent to the
// traveller's +trip address - those get the lenient extraction (a forwarded
// "the hotel sent you a message" still yields the hotel name and details).
async function gmailMessage(token, id) {
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`,
    { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return { text: "", plus: false };
  const msg = await res.json();
  const heads = ((msg.payload && msg.payload.headers) || [])
    .filter((h) => /^(to|cc|bcc|delivered-to|x-forwarded-to|x-original-to)$/i.test(h.name || ""))
    .map((h) => h.value || "").join(" ");
  const plus = /\+trip@/i.test(heads);
  const parts = [], htmlParts = [];
  (function walk(p) {
    if (!p) return;
    if (p.mimeType === "text/plain" && p.body && p.body.data) parts.push(b64(p.body.data));
    else if (p.mimeType === "text/html" && p.body && p.body.data) htmlParts.push(b64(p.body.data));
    (p.parts || []).forEach(walk);
  })(msg.payload);
  if (parts.length) return { text: parts.join("\n"), plus };
  // Booking confirmations (and many forwards) are HTML-only - strip to text
  // instead of silently skipping them.
  if (htmlParts.length) return { text: htmlParts.join("\n")
    .replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|tr|li|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&#39;|&apos;/gi, "'").replace(/&quot;/gi, '"')
    .replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").trim(), plus };
  return { text: "", plus };
}

function dedupeSegs(segs) {
  const seen = {}, out = [];
  for (const s of segs) {
    const key = s.conf || (s.type + "|" + s.name + "|" + s.start);
    if (seen[key]) continue;
    seen[key] = 1; out.push(s);
  }
  return out.sort((a, b) => ((a.start || "") < (b.start || "") ? -1 : 1));
}
function addSegment(trip, seg, store) {
  // Deleted on purpose stays deleted: if this conf was tombstoned, never re-add
  // it, whatever source is trying (calendar, Gmail, re-import).
  if (seg.conf && store && store.deletedSegs && store.deletedSegs[seg.conf]) return;
  trip.segments = trip.segments || [];
  const ex = seg.conf ? trip.segments.find((s) => s.conf === seg.conf) : null;
  if (ex) {
    // same booking seen again: refresh the ingested copy with the richer
    // details (note, cleaned address) - manual plans are NEVER touched
    if (ex.source !== "manual") {
      if (seg.note) ex.note = seg.note;
      if (seg.address) ex.address = seg.address;
      if (seg.name) ex.name = seg.name;
    }
    return;
  }
  trip.segments.push(seg);
  trip.segments.sort(segCmp);
  trip.updatedAt = Date.now();
}
// Same-day plans order by their TIME, which lives in the note ("TP1328
// OPO-LGW 09:00-11:20", "18:00-21:30 · dinner"): first clock time found is
// the sort key, no time = midday. When neither side has a time, travel logic
// breaks the tie: flight, then transfers, then hotel, then the rest.
function segSortKey(s) {
  if (!s || !s.start) return "9999-12-31T12:00";
  const tm = /[T\s](\d{1,2}):(\d{2})/.exec(s.start);
  if (tm) {
    return s.start.slice(0, 10) + "T" + ("0" + tm[1]).slice(-2) + ":" + tm[2];
  }
  const m = /([01]?\d|2[0-3]):([0-5]\d)/.exec(s.note || "");
  return s.start.slice(0, 10) + "T" + (m ? ("0" + m[1]).slice(-2) + ":" + m[2] : "12:00");
}
const SEG_RANK = { flight: 0, rail: 1, car: 2, ride: 3, hotel: 4, restaurant: 5 };
function segCmp(a, b) {
  const ka = segSortKey(a), kb = segSortKey(b);
  return ka < kb ? -1 : ka > kb ? 1 : (SEG_RANK[a.type] !== undefined ? SEG_RANK[a.type] : 6) - (SEG_RANK[b.type] !== undefined ? SEG_RANK[b.type] : 6);
}
function findTripForDate(store, dateISO) {
  return Object.values(store.trips).find((t) => t.start && t.end && dateISO >= t.start && dateISO <= t.end);
}
// "Funchal" must land in a trip called "Madeira": geocode the booking's city
// once (free geocoder, cached in the store) so island/region names match too.
async function cityGeo(store, city) {
  const key = normCity(city);
  if (!key) return null;
  store.geoCache = store.geoCache || {};
  if (store.geoCache[key] !== undefined) return store.geoCache[key];
  const g = await geocodeName(city);
  return (store.geoCache[key] = g ? { name: g.name || "", admin1: g.admin1 || "", country: g.country || "" } : null);
}
function cityMatchesTrip(t, city, geo) {
  const cityN = normCity(city);
  if (!cityN) return false;
  const dest = normCity(t.to) + " " + normCity(t.label);
  if (dest.includes(cityN)) return true;
  if (normCity(t.to).length > 2 && cityN.includes(normCity(t.to))) return true;
  return !!(geo && ((geo.admin1 && geo.admin1.length > 2 && dest.includes(normCity(geo.admin1)))
    || (geo.name && dest.includes(normCity(geo.name)))));
}
// Date decides, destination referees: of the trips covering the date, prefer
// the one matching the booking's city, so overlapping trips don't steal each
// other's hotels.
async function findTripForSeg(store, seg, city) {
  const covering = Object.values(store.trips).filter((t) => t.start && t.end && seg.start >= t.start && seg.start <= t.end);
  if (covering.length > 1 && city) {
    const geo = await cityGeo(store, city);
    const m = covering.find((t) => cityMatchesTrip(t, city, geo));
    if (m) return m;
  }
  return covering[0];
}
// For deliberately forwarded emails WITHOUT dates (e.g. "the hotel sent you a
// message"): file by destination - the next trip matching the city, else the
// most recent past one.
async function findTripByCity(store, city) {
  if (!normCity(city)) return null;
  const geo = await cityGeo(store, city);
  const matches = Object.values(store.trips)
    .filter((t) => t.start && cityMatchesTrip(t, city, geo))
    .sort((a, b) => ((a.start || "") < (b.start || "") ? -1 : 1));
  const today = new Date().toISOString().slice(0, 10);
  return matches.find((t) => (t.end || t.start) >= today) || matches.pop() || null;
}
function guessType(s) {
  s = s.toLowerCase();
  if (/flight|airlines?|\b[a-z]{2}\d{2,4}\b/.test(s)) return "flight";
  if (/hotel|airbnb|booking|stay|inn|resort/.test(s)) return "hotel";
  if (/car|rental|hertz|avis|sixt/.test(s)) return "car";
  if (/uber|bolt|ride|pickup|driver|transfer/.test(s)) return "ride";
  if (/train|rail|sncf|trenitalia|shinkansen|jr/.test(s)) return "rail";
  if (/restaurant|cafe|coffee|dining|bistro|dinner|lunch|bar|food|ramen|sushi|table|resy|opentable|tabelog|bbq|steak|pizza|michelin/.test(s)) return "restaurant";
  return "other";
}
function norm(d) { return d ? String(d).slice(0, 10) : ""; }
// Strip map links / HTML from calendar fields; keep the human-readable part.
function cleanLoc(s) { return (s || "").replace(/https?:\/\/\S+/g, "").replace(/[\s,\u00b7|\u2013-]+$/g, "").trim(); }
function cleanDesc(s) {
  return (s || "").replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, " ")
    .replace(/https?:\/\/\S+/g, "").replace(/&nbsp;/gi, " ").replace(/\s+/g, " ").trim();
}
// The one line a traveller needs on the card: time of day + the useful part
// of the description (door codes, flight numbers, who/what - not the essay).
function evNote(ev) {
  const bits = [];
  const st = ev.start && ev.start.dateTime, en = ev.end && ev.end.dateTime;
  if (st) bits.push(st.slice(11, 16) + (en ? "-" + en.slice(11, 16) : ""));
  const d = cleanDesc(ev.description);
  if (d) bits.push(d.length > 160 ? d.slice(0, 157) + "\u2026" : d);
  return bits.join(" \u00b7 ");
}
// A real YYYY-MM-DD, not just a non-empty string. The app validates dates,
// but POST /trips stores whatever it is handed, so anything reading dates back
// out (ICS feed, calendar write) must not assume they parse.
function isDate(s) { return /^\d{4}-\d{2}-\d{2}$/.test(s || "") && !isNaN(new Date(s + "T00:00:00Z").getTime()); }
function addDay(iso) { const dt = new Date(iso + "T00:00:00Z"); if (isNaN(dt.getTime())) return iso; dt.setUTCDate(dt.getUTCDate() + 1); return dt.toISOString().slice(0, 10); }
function sig(t) { return [t.from, t.to, t.start, t.end].join("|").toLowerCase(); }
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
function b64(s) { return decodeURIComponent(escape(atob(s.replace(/-/g, "+").replace(/_/g, "/")))); }

function randHex(bytes) {
  const b = new Uint8Array(bytes); crypto.getRandomValues(b);
  return Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("");
}
// Anonymous install count. Fires exactly ONCE per instance, the moment its
// password is first set (the one universal "this is now a real install"
// moment). The wire body is { id } and NOTHING else - no trip, no key, no
// email, no IP beyond what Cloudflare's own edge logs already keep for any
// request. `id` is 128 random bits generated by THIS instance and stored in
// its own KV; it cannot be reversed to anything about you or your trips, and
// exists only so a re-run of setup can't be double-counted. Full mechanics
// and the exact code that receives this ping: counter/counter-worker.js.
//
// Off by default: with TELEMETRY_URL blank (see wrangler.toml), this
// function returns immediately and no network call is ever made. Blank that
// line (or delete this whole block) to opt any instance out completely -
// nothing else in the app depends on it.
async function pingInstallCount(env) {
  try {
    const dest = env.TELEMETRY_URL || "";
    if (!dest) return;
    let id = await env.TRIPS.get("install_id");
    if (!id) { id = randHex(16); await env.TRIPS.put("install_id", id); }
    await fetch(dest.replace(/\/+$/, "") + "/ping", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }),
    });
  } catch (e) { /* a counter hiccup must never affect setup */ }
}
// Weekly rotating snapshot (4 slots = ~a month of history). Runs Sundays only.
async function maybeSnapshot(env) {
  try {
    if (new Date().getUTCDay() !== 0) return;
    const raw = await env.TRIPS.get("store");
    if (!raw) return;
    const slot = Math.floor(Date.now() / (7 * 86400000)) % 4;
    await env.TRIPS.put("backup:" + slot, JSON.stringify({ at: Date.now(), raw }));
  } catch (e) { console.error("snapshot", e); }
}
function hesc(s) { return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
// The companion page: everything a travel buddy needs, nothing they can break.
function shareTripHtml(t) {
  const segs = (t.segments || []).slice().sort(segCmp);
  const rows = segs.map((s) => {
    const when = (s.start || "") + (s.end && s.end !== s.start ? " – " + s.end : "");
    return '<div class="p"><div class="t">' + hesc(s.type || "plan") + '</div><div class="b"><b>' + hesc(s.name || "Booking") + "</b>"
      + (s.note ? "<br>" + hesc(s.note) : "") + (s.address ? '<br><span class="a">' + hesc(s.address) + "</span>" : "")
      + '</div><div class="w">' + hesc(when) + "</div></div>";
  }).join("");
  return '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">'
    + "<title>" + hesc(t.label || t.to || "Trip") + "</title>"
    + "<style>body{font-family:-apple-system,Segoe UI,sans-serif;background:#f4efe4;color:#16130c;margin:0;padding:28px 18px;display:flex;justify-content:center}"
    + "main{max-width:560px;width:100%}h1{font-size:30px;margin:0 0 4px}.d{color:#756d5e;margin:0 0 22px;font-size:15px}"
    + ".p{display:flex;gap:12px;background:#fff;border:1px solid #e5decd;border-radius:14px;padding:14px 16px;margin-bottom:10px;align-items:flex-start}"
    + ".t{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#1b8a57;background:rgba(27,138,87,.1);padding:3px 8px;border-radius:999px;flex:0 0 auto;margin-top:2px}"
    + ".b{flex:1;line-height:1.5;font-size:15px}.a{color:#756d5e}.w{flex:0 0 auto;font-size:13px;color:#756d5e;white-space:nowrap}"
    + "footer{margin-top:22px;color:#a9a190;font-size:12px}</style>"
    + "<main><h1>" + hesc(t.label || t.to || "Trip") + "</h1><p class='d'>" + hesc(t.to || "") + " · " + hesc(t.start || "") + " – " + hesc(t.end || "") + (t.timezone ? " · 🕒 " + hesc(t.timezone) : "") + "</p>"
    + (rows || "<p class='d'>No plans on this trip yet.</p>")
    + "<footer>Shared read-only · plans update live as the trip owner adds them</footer></main>";
}
// Minimal, standards-happy ICS: one all-day event per trip, plans in the description.
function icsEscape(s) { return String(s || "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n"); }
function buildIcs(store) {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
  const ev = Object.values(store.trips).filter((t) => isDate(t.start) && isDate(t.end)).map((t) => {
    let desc = (t.segments || []).slice().sort(segCmp)
      .map((s) => (s.type || "plan") + ": " + (s.name || "") + (s.note ? " — " + s.note : "")).join("\n");
    if (t.timezone) desc = (desc ? desc + "\n" : "") + "Timezone: " + t.timezone;
    return ["BEGIN:VEVENT",
      "UID:" + t.id + "@travel-hub",
      "DTSTAMP:" + stamp,
      "DTSTART;VALUE=DATE:" + t.start.replace(/-/g, ""),
      "DTEND;VALUE=DATE:" + addDay(t.end).replace(/-/g, ""),   // all-day DTEND is exclusive
      "SUMMARY:" + icsEscape("Trip: " + (t.label || t.to || "Travel")),
      desc ? "DESCRIPTION:" + icsEscape(desc) : "",
      "END:VEVENT"].filter(Boolean).join("\r\n");
  }).join("\r\n");
  return "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//888travel//EN\r\nCALSCALE:GREGORIAN\r\nX-WR-CALNAME:888漫步旅遊 · 888travel\r\nX-WR-TIMEZONE:Asia/Taipei\r\n" + ev + "\r\nEND:VCALENDAR\r\n";
}

// --- Multi-Tenant Storage & Namespace Accessors ---
async function loadTenantStore(env, uid) {
  const targetUid = uid || "usr_admin";
  const raw = await env.TRIPS.get("store:" + targetUid);
  if (raw) {
    try { return JSON.parse(raw); } catch(e) {}
  }
  // Backward compatibility fallback for admin
  if (targetUid === "usr_admin") {
    const legacy = await env.TRIPS.get("store");
    if (legacy) {
      try { return JSON.parse(legacy); } catch(e) {}
    }
  }
  return { trips: {}, seenEmails: {}, deletedSegs: {} };
}

async function saveTenantStore(env, uid, store) {
  const targetUid = uid || "usr_admin";
  const str = JSON.stringify(store);
  await env.TRIPS.put("store:" + targetUid, str);
  // Mirror to legacy store if admin for backward compatibility with external scripts
  if (targetUid === "usr_admin") {
    await env.TRIPS.put("store", str);
  }
}

async function loadStore(env, uid) {
  return await loadTenantStore(env, uid || "usr_admin");
}
async function saveStore(env, store, uid) {
  return await saveTenantStore(env, uid || "usr_admin", store);
}

// --- System Configuration ---
async function getSystemConfig(env) {
  const raw = await env.TRIPS.get("system:config");
  if (raw) {
    try { return JSON.parse(raw); } catch(e) {}
  }
  const adminEmail = (await env.TRIPS.get("auth_email")) || null;
  return {
    allow_registration: false,
    admin_email: adminEmail ? adminEmail.toLowerCase().trim() : null,
    shared_ai_pool: false,
    version: 2
  };
}

async function saveSystemConfig(env, cfg) {
  await env.TRIPS.put("system:config", JSON.stringify(cfg));
}

// --- User Management ---
async function getUserByEmail(env, email) {
  if (!email) return null;
  const raw = await env.TRIPS.get("user:by_email:" + email.toLowerCase().trim());
  if (raw) {
    try { return JSON.parse(raw); } catch(e) {}
  }
  return null;
}

async function getUserById(env, uid) {
  if (!uid) return null;
  const raw = await env.TRIPS.get("user:by_id:" + uid);
  if (raw) {
    try { return JSON.parse(raw); } catch(e) {}
  }
  return null;
}

async function saveUser(env, user) {
  const emailKey = user.email.toLowerCase().trim();
  await env.TRIPS.put("user:by_email:" + emailKey, JSON.stringify(user));
  await env.TRIPS.put("user:by_id:" + user.uid, JSON.stringify(user));
}

async function listAllUsers(env) {
  try {
    const list = await env.TRIPS.list({ prefix: "user:by_id:" });
    const users = [];
    for (const key of list.keys) {
      const raw = await env.TRIPS.get(key.name);
      if (raw) {
        try {
          const u = JSON.parse(raw);
          users.push({
            uid: u.uid,
            email: u.email,
            role: u.role || "user",
            status: u.status || "active",
            createdAt: u.createdAt || 0
          });
        } catch(e) {}
      }
    }
    return users.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  } catch(e) {
    return [];
  }
}

// --- Dynamic Session Management ---
async function createSession(env, user) {
  const token = "s_" + crypto.randomUUID().replace(/-/g, "") + randHex(12);
  const sessionData = {
    uid: user.uid,
    email: user.email,
    role: user.role || "user",
    createdAt: Date.now(),
    expiresAt: Date.now() + 2592000000 // 30 days
  };
  await env.TRIPS.put("session:" + token, JSON.stringify(sessionData), { expirationTtl: 2592000 });
  return token;
}

async function resolveSession(request, env) {
  const header = request.headers.get("X-Auth") || "";
  const m = (request.headers.get("Cookie") || "").match(/(?:^|;\s*)tk=([^;]+)/);
  const cookie = m ? m[1] : "";
  const token = header || cookie;
  if (!token) return null;

  // 1. Dynamic multi-tenant session token
  if (token.startsWith("s_")) {
    const raw = await env.TRIPS.get("session:" + token);
    if (raw) {
      try {
        const s = JSON.parse(raw);
        if (s && s.uid) return s;
      } catch(e) {}
    }
  }

  // 2. Legacy admin password hash session fallback
  const stored = await env.TRIPS.get("auth");
  if (stored && token === stored) {
    const storedEmail = ((await env.TRIPS.get("auth_email")) || "admin@local").trim().toLowerCase();
    let adminUser = await getUserByEmail(env, storedEmail);
    if (!adminUser) {
      adminUser = {
        uid: "usr_admin",
        email: storedEmail,
        passwordHash: stored,
        role: "admin",
        status: "active",
        createdAt: Date.now()
      };
      await saveUser(env, adminUser);
    }
    return { uid: adminUser.uid, email: adminUser.email, role: "admin" };
  }

  return null;
}

// --- Auto Migration for Existing Single-User Installations ---
async function ensureMultiTenantMigration(env) {
  const cfg = await env.TRIPS.get("system:config");
  if (cfg) return; // already migrated or configured

  const storedAuth = await env.TRIPS.get("auth");
  const storedEmail = (await env.TRIPS.get("auth_email")) || "";
  if (storedAuth) {
    const adminUid = "usr_admin";
    const adminEmail = storedEmail.trim().toLowerCase() || "admin@local";
    const adminUser = {
      uid: adminUid,
      email: adminEmail,
      passwordHash: storedAuth,
      role: "admin",
      status: "active",
      createdAt: Date.now()
    };
    await saveUser(env, adminUser);

    const legacyStore = await env.TRIPS.get("store");
    if (legacyStore) {
      const existing = await env.TRIPS.get("store:" + adminUid);
      if (!existing) {
        await env.TRIPS.put("store:" + adminUid, legacyStore);
      }
    }

    await saveSystemConfig(env, {
      allow_registration: false,
      admin_email: adminEmail,
      shared_ai_pool: false,
      version: 2
    });
  }
}

// Optional Turnstile bot verification
async function verifyTurnstile(env, token, ip) {
  if (!env.TURNSTILE_SECRET_KEY) return true;
  if (!token) return false;
  try {
    const formData = new FormData();
    formData.append("secret", env.TURNSTILE_SECRET_KEY);
    formData.append("response", token);
    if (ip) formData.append("remoteip", ip);
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body: formData
    });
    const d = await res.json();
    return !!d.success;
  } catch(e) {
    return false;
  }
}

async function sha256(s) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Successful login: return the token AND set a durable HttpOnly session cookie
function okLogin(token, user, status = 200) {
  const payload = { ok: true, token };
  if (user) {
    payload.user = { uid: user.uid, email: user.email, role: user.role || "user" };
  }
  const r = cors(json(payload, status));
  r.headers.append("Set-Cookie", `tk=${token}; Max-Age=2592000; Path=/; Secure; HttpOnly; SameSite=Lax`);
  return r;
}

async function authGuard(request, env) {
  const session = await resolveSession(request, env);
  if (session) {
    request.session = session;
    return null;
  }
  const stored = await env.TRIPS.get("auth");
  if (!stored) return json({ error: "setup required - create your password first" }, 401);
  return json({ error: "unauthorized" }, 401);
}

async function agentAuthGuard(request, env) {
  const authHeader = request.headers.get("Authorization") || "";
  const storedAgentKey = await env.TRIPS.get("agent_api_key");

  if (authHeader.toLowerCase().startsWith("bearer ")) {
    const token = authHeader.slice(7).trim();
    // 1. Check user-scoped agent token
    const tokenSessionRaw = await env.TRIPS.get("agent_token:" + token);
    if (tokenSessionRaw) {
      try {
        const sess = JSON.parse(tokenSessionRaw);
        request.session = sess;
        return null;
      } catch(e) {}
    }
    // 2. Fallback to legacy instance-wide agent key (maps to usr_admin)
    if (storedAgentKey && token === storedAgentKey) {
      request.session = { uid: "usr_admin", role: "admin", email: (await env.TRIPS.get("auth_email")) || "admin@local" };
      return null;
    }
  }

  // Developer / admin session fallback (X-Auth or tk cookie)
  const session = await resolveSession(request, env);
  if (session) {
    request.session = session;
    return null;
  }

  const storedAuth = await env.TRIPS.get("auth");
  if (!storedAgentKey && !storedAuth) {
    return json({ error: "Setup required - configure instance first" }, 401);
  }
  return json({ error: "Unauthorized: Invalid or missing Agent API Bearer token" }, 401);
}

function json(obj, status) { return new Response(JSON.stringify(obj), { status: status || 200, headers: { "Content-Type": "application/json" } }); }
function cors(res) {
  const h = new Headers(res.headers);
  h.set("Access-Control-Allow-Origin", "*");
  h.set("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  h.set("Access-Control-Allow-Headers", "Content-Type, X-Auth, Authorization");
  return new Response(res.body, { status: res.status, headers: h });
}



const LLMS_TXT = `# 888漫步旅遊 · 888travel

> Single-tenant, privacy-first personal travel hub with multi-language itinerary planning, live calendar subscriptions, Google Places verification, contingency fallback management, and a dedicated RESTful Agent API.

## Overview
888travel is a personal travel command center designed to run serverlessly on Cloudflare Workers and Cloudflare KV. It aggregates bookings from Google Calendar, Gmail, and manual user inputs into a unified, chronological timeline.

This instance provides a comprehensive RESTful API (\`/api/v1\`) designed specifically for external AI agents (Claude Code, Antigravity, Cursor, OpenAI Agents, LangChain) to plan, query, update, and manage trips, granular itinerary items, verified places, fallback plans, wishlist radar, backups, and live synchronization.

## Machine-Readable Documents
- [/skill.md](https://travel.david888.com/skill.md): Canonical Agent Skill specification with tool definitions and instructions.
- [/llms-full.txt](https://travel.david888.com/llms-full.txt): Comprehensive API documentation, full JSON schemas, and usage examples.

## Key Capabilities & Rules
1. **Full Trips CRUD**: Create, read, update, and delete multi-day travel itineraries (\`GET\`, \`POST\`, \`PUT\`, \`DELETE /api/v1/trips\`).
2. **Granular Segment Planning**: Append, edit, or remove itinerary segments individually or in high-performance batches (\`POST\`, \`PUT\`, \`DELETE /api/v1/trips/:id/segments\`).
3. **7 Standard Categories**:
   - \`flight\` ✈️: Airline flights, layovers, and airport terminals.
   - \`hotel\` 🏨: Accommodations, hotels, ryokans, resorts, and Airbnbs.
   - \`restaurant\` 🍽️: Dining reservations, culinary spots, and cafes.
   - \`rail\` 🚆: Trains, Shinkansen, high-speed rail, metro, and scenic rail.
   - \`car\` 🚗: Rental cars and vehicle hire pick-up and drop-off.
   - \`ride\` 🚕: Taxis, airport transfers, and private chauffeurs.
   - \`other\` 📍: Attractions, museums, activities, and meetings.
4. **Smart Contingency & Fallback Plans**: Attach alternative backup plans to any item. Support 1-click in-app promotion and programmatic 1-click swap (\`POST /api/v1/trips/:id/segments/:sid/swap-fallback\`).
5. **Google Places Discovery**: Search verified real-world places, opening hours, Google ratings, review counts, and Maps links (\`POST /api/v1/places/search\`, \`POST /api/v1/places/details\`).
6. **Wishlist Radar & Airfare Tracking**: Maintain future destinations, target budgets, and travel months (\`GET\`, \`POST\`, \`DELETE /api/v1/wishes\`).
7. **On-Demand Sync Trigger**: Programmatically trigger Google Calendar & Gmail synchronization passes (\`POST /api/v1/sync\`).
8. **Cloud Snapshots & Export**: Inspect automatic KV backup snapshots and download full data exports (\`GET /api/v1/backups\`, \`GET /api/v1/export\`).
9. **In-App AI Copilot Chat**: Query 888travel's internal AI travel assistant with active trip context to generate structured proposal cards (\`POST /api/v1/copilot/chat\`).
10. **Manual Invariant Protection**: All items created via the Agent API are stamped with \`source: "manual"\`. They will NEVER be overwritten or deleted by automated background calendar or email synchronization.
11. **Instance Health & Status**: Inspect instance health, version, trip counts, and active integration flags (\`GET /api/v1/status\`).

## Quick API Reference

### Base URL & Authentication
- Base URL: \`https://<your-instance-domain>/api/v1\`
- Header: \`Authorization: Bearer rr_agent_<your-token>\`
- Content-Type: \`application/json\`

### Endpoints Index
- \`GET /api/v1/status\`: Instance health, metrics, and integrations status.
- \`GET /api/v1/trips\`: List all trips with summary metrics and segments.
- \`POST /api/v1/trips\`: Create a new trip with destination, dates, notes, and optional initial segments.
- \`GET /api/v1/trips/:id\`: Retrieve single trip details by ID.
- \`PUT /api/v1/trips/:id\`: Update trip destination, dates, timezone, photo, or notes.
- \`DELETE /api/v1/trips/:id\`: Delete a trip and its itinerary.
- \`POST /api/v1/trips/:id/segments\`: Append single segment or batch array of segments (with optional fallback plans).
- \`PUT /api/v1/trips/:id/segments/:sid\`: Update an existing segment.
- \`DELETE /api/v1/trips/:id/segments/:sid\`: Delete an itinerary segment with automatic tombstoning.
- \`POST /api/v1/trips/:id/segments/:sid/swap-fallback\`: 1-Click swap primary plan with its backup fallback plan.
- \`POST /api/v1/places/search\`: Search Google Places for verified venues, ratings, reviews, open status.
- \`POST /api/v1/places/details\`: Fetch details for a specific Google Place ID.
- \`GET /api/v1/wishes\`: List all wishlist travel radar items.
- \`POST /api/v1/wishes\`: Add or update a wishlist radar item.
- \`DELETE /api/v1/wishes/:id\`: Delete a wishlist radar item.
- \`POST /api/v1/sync\`: Trigger on-demand sync of Google Calendar and Gmail.
- \`GET /api/v1/backups\`: List automated weekly and pre-restore cloud snapshot backups.
- \`GET /api/v1/export\`: Export complete instance JSON data backup.
- \`POST /api/v1/copilot/chat\`: Chat with the in-app AI travel copilot with active trip context.

## Getting Started for Agents
1. Have the user generate an Agent API Key in the web app under Settings -> AI Agent Integration.
2. Verify connectivity with \`GET /api/v1/status\` or \`GET /api/v1/trips\`.
3. Read [/skill.md](https://travel.david888.com/skill.md) or [/llms-full.txt](https://travel.david888.com/llms-full.txt) for detailed schemas and prompt engineering guidelines.
`;

const LLMS_FULL_TXT = `# 888漫步旅遊 · 888travel - Full LLM & API Reference

> Machine-readable specification and guide for AI Agents, autonomous planners, and automation systems integrating with 888travel.

---

## 1. System Architecture & Invariants

888travel is a privacy-first, single-tenant personal travel hub. All data is persisted in Cloudflare KV as a unified store.

### The Invariant Rules
1. **Manual Invariant**: Any segment created or updated via the Agent API is assigned \`source: "manual"\`. The background sync engine (which periodically scans Google Calendar and Gmail) will **NEVER** overwrite, modify, or delete manual plans.
2. **Category Fidelity**: Categories must strictly match one of the 7 supported values:
   - \`flight\` ✈️: Flight bookings, airport codes, flight numbers, terminals.
   - \`hotel\` 🏨: Accommodations, hotels, ryokans, villas, Airbnbs.
   - \`restaurant\` 🍽️: Dining, restaurants, cafes, food stalls, ramen shops, izakayas.
   - \`rail\` 🚆: Trains, high-speed rail (Shinkansen, TGV, ICE), subways, scenic railways.
   - \`car\` 🚗: Rental cars, car hire pick-up and drop-off.
   - \`ride\` 🚕: Taxi, airport pick-up, Uber, private chauffeur.
   - \`other\` 📍: Sightseeing attractions, theme parks, museum entries, appointments.
3. **Contingency / Fallback Plans**: Any segment can hold an embedded \`fallback\` object representing a backup alternative. If the primary plan is full, closed, or delayed, the user can switch to the fallback plan in 1 click in the UI, or agents can invoke \`/swap-fallback\`.
4. **Data Layer Purity**: Never localize data literals (e.g. store \`"flight"\`, not \`"航班"\`). UI and markdown formatters handle display localization.

---

## 2. Authentication

External agents authenticate using an HTTP Bearer token in the \`Authorization\` header:

\`\`\`http
Authorization: Bearer rr_agent_<token>
Content-Type: application/json
\`\`\`

Agent keys are generated in the 888travel Web App (Settings -> AI Agent Integration). Tokens are prefixed with \`rr_agent_\` and can be regenerated or revoked at any time.

---

## 3. Data Schemas

### Trip Schema
\`\`\`json
{
  "id": "t_202610_tokyo",
  "from": "TPE",
  "to": "NRT",
  "start": "2026-10-15",
  "end": "2026-10-20",
  "label": "Tokyo Autumn Voyage",
  "notes": "Flight booked via BR198",
  "timezone": "Asia/Tokyo",
  "photo": "https://example.com/p.jpg",
  "segments": [],
  "updatedAt": 1729000000000
}
\`\`\`

### Segment Schema
\`\`\`json
{
  "sid": "s_123456",
  "type": "restaurant",
  "name": "Ichiran Ramen Shibuya",
  "address": "1-22-7 Jinnan, Shibuya",
  "note": "18:00 Dinner reservation",
  "start": "2026-10-15T18:00",
  "end": "2026-10-15T19:30",
  "conf": "RES-889900",
  "source": "manual",
  "rating": 4.5,
  "userRatingsTotal": 2450,
  "openNow": true,
  "mapsUrl": "https://maps.google.com/?cid=123",
  "placeId": "ChIJN1t_tDeuEmsRUsoyG83frY4",
  "fallback": {
    "name": "Afuri Ramen Harajuku",
    "address": "1-1-7 Jingumae, Shibuya",
    "note": "Backup option if Ichiran line exceeds 30 mins",
    "mapsUrl": "https://maps.google.com/?cid=456",
    "rating": 4.3,
    "userRatingsTotal": 1820
  }
}
\`\`\`

### Wishlist Item Schema
\`\`\`json
{
  "id": "w_98765",
  "from": "TPE",
  "dest": "KIX",
  "days": "6",
  "month": "November",
  "budget": "NT$35,000",
  "note": "Autumn maple season flight deals",
  "updatedAt": 1729000000000
}
\`\`\`

---

## 4. Comprehensive API Endpoints Specification

### 4.1 System & Diagnostics

#### \`GET /api/v1/status\`
Returns instance health, version, metric counts, and configured integrations.
- **Request**: No body required.
- **Response**: \`200 OK\`

### 4.2 Trips Management

#### \`GET /api/v1/trips\`
Retrieves all trips sorted chronologically by start date.

#### \`GET /api/v1/trips/:id\`
Retrieves single trip details by ID.

#### \`POST /api/v1/trips\`
Creates a new trip.

#### \`PUT /api/v1/trips/:id\`
Updates an existing trip's properties (\`from\`, \`to\`, \`start\`, \`end\`, \`label\`, \`notes\`, \`timezone\`, \`photo\`).

#### \`DELETE /api/v1/trips/:id\`
Deletes a trip and its itinerary.

### 4.3 Segments & Fallback Orchestration

#### \`POST /api/v1/trips/:id/segments\`
Appends one or more itinerary segments to an existing trip (single object or array of objects).

#### \`PUT /api/v1/trips/:id/segments/:sid\`
Updates an existing segment.

#### \`DELETE /api/v1/trips/:id/segments/:sid\`
Removes a segment from the trip and tombstones its confirmation reference.

#### \`POST /api/v1/trips/:id/segments/:sid/swap-fallback\`
1-Click Contingency Swap: Swaps the active primary plan with its configured fallback alternative.

### 4.4 Google Places Discovery

#### \`POST /api/v1/places/search\`
Queries Google Places API for verified venues, ratings, review counts, and open status.
- **Request Body**: \`{ "query": "Ginza Kagari", "language": "zh-TW" }\`

#### \`POST /api/v1/places/details\`
Retrieves detailed information for a specific Google Place ID.
- **Request Body**: \`{ "placeId": "ChIJ..." }\`

### 4.5 Wishlist & Airfare Radar

#### \`GET /api/v1/wishes\`
Retrieves all tracked wishlist radar items.

#### \`POST /api/v1/wishes\`
Creates or updates a wishlist radar item.

#### \`DELETE /api/v1/wishes/:id\`
Deletes a tracked wishlist item.

### 4.6 Synchronization & Snapshots

#### \`POST /api/v1/sync\`
Triggers an immediate background synchronization pass with Google Calendar and Gmail.

#### \`GET /api/v1/backups\`
Lists all available weekly automated cloud snapshots and pre-restore snapshots.

#### \`GET /api/v1/export\`
Exports a full JSON snapshot of trips, wishes, and home configuration.

### 4.7 In-App AI Copilot Chat

#### \`POST /api/v1/copilot/chat\`
Allows external agents or companion tools to chat directly with 888travel's internal AI copilot with active trip context.
`;

const SKILL_MD = `---
name: 888travel-planner
description: Comprehensive autonomous travel planning, itinerary management, Google Places exploration, contingency fallback orchestration, and wishlist radar skill for 888travel.
---

# 888travel Travel Planner Skill

Use this skill when tasked with researching, structuring, modifying, or managing travel itineraries in 888travel. This skill gives you direct RESTful API access to manage multi-day trips, granular itinerary items, Google Places discovery, contingency fallback plans, wishlist radar, backups, and synchronizations.

## Configuration & Headers
- **Base URL**: \`https://<your-instance-domain>/api/v1\`
- **Headers**:
  \`\`\`http
  Authorization: Bearer <AGENT_API_KEY>
  Content-Type: application/json
  \`\`\`

## 7 Standard Categories
Every itinerary segment must strictly use one of the following 7 categories:
1. \`flight\` ✈️: Flights, connections, airport departure/arrival.
2. \`hotel\` 🏨: Accommodations, hotels, ryokans, resorts, Airbnbs.
3. \`restaurant\` 🍽️: Dining, restaurants, food stalls, cafes, bars.
4. \`rail\` 🚆: Trains, Shinkansen, high-speed rail, subways.
5. \`car\` 🚗: Rental cars, car hire pick-up and drop-off.
6. \`ride\` 🚕: Taxis, airport transfers, ride-hailing services.
7. \`other\` 📍: Sightseeing attractions, museums, activities, meetings.

## Contingency & Fallback Plans
Travelers encounter unexpected queues, closures, and weather changes. Whenever proposing restaurants or outdoor activities, attach a viable alternative in the \`fallback\` object:
\`\`\`json
{
  "type": "restaurant",
  "name": "Primary Target Restaurant",
  "address": "Primary Address",
  "start": "2026-10-16T18:30",
  "note": "18:30 dinner",
  "fallback": {
    "name": "Alternative Backup Restaurant",
    "address": "Backup Address nearby",
    "note": "Backup in case line exceeds 30m or booked out"
  }
}
\`\`\`

---

## Available Tool Actions & Endpoints

### 1. \`get_status\`
Check instance health, version, trip counts, and active integration flags.
- **Method**: \`GET /api/v1/status\`

### 2. \`list_trips\`
Retrieve all existing trips to check dates or find a trip ID.
- **Method**: \`GET /api/v1/trips\`

### 3. \`get_trip\`
Fetch complete trip details including all segments and notes.
- **Method**: \`GET /api/v1/trips/:id\`

### 4. \`create_trip\`
Create a new multi-day trip container.
- **Method**: \`POST /api/v1/trips\`

### 5. \`update_trip\`
Modify trip dates, destination, notes, timezone, or photo.
- **Method**: \`PUT /api/v1/trips/:id\`

### 6. \`delete_trip\`
Delete a trip and its entire itinerary.
- **Method**: \`DELETE /api/v1/trips/:id\`

### 7. \`add_segments\` (Batch or Single)
Add itinerary items to a trip. Pass an array of items for high-performance batch creation.
- **Method**: \`POST /api/v1/trips/:id/segments\`

### 8. \`update_segment\`
Update an individual itinerary item.
- **Method**: \`PUT /api/v1/trips/:id/segments/:sid\`

### 9. \`delete_segment\`
Delete a segment. Deletion is automatically tombstoned to prevent calendar/email sync resurrection.
- **Method**: \`DELETE /api/v1/trips/:id/segments/:sid\`

### 10. \`swap_fallback\`
1-Click Contingency Swap: Promotes the configured fallback plan to primary and sets the former primary as fallback.
- **Method**: \`POST /api/v1/trips/:id/segments/:sid/swap-fallback\`

### 11. \`search_places\`
Search Google Places for verified venues, ratings, review counts, and open status.
- **Method**: \`POST /api/v1/places/search\`

### 12. \`get_place_details\`
Retrieve operating hours, phone, website, and location details for a Google Place ID.
- **Method**: \`POST /api/v1/places/details\`

### 13. \`list_wishes\`
List tracked travel wishlist destinations, preferred months, and budgets.
- **Method**: \`GET /api/v1/wishes\`

### 14. \`add_wish\`
Add or update a travel wishlist item.
- **Method**: \`POST /api/v1/wishes\`

### 15. \`delete_wish\`
Delete a wishlist radar item.
- **Method**: \`DELETE /api/v1/wishes/:id\`

### 16. \`trigger_sync\`
Trigger on-demand background sync with Google Calendar and Gmail.
- **Method**: \`POST /api/v1/sync\`

### 17. \`list_backups\`
List automated cloud snapshot backups.
- **Method**: \`GET /api/v1/backups\`

### 18. \`export_data\`
Download full instance JSON export.
- **Method**: \`GET /api/v1/export\`

### 19. \`chat_copilot\`
Query 888travel's internal AI copilot with active trip context.
- **Method**: \`POST /api/v1/copilot/chat\`
`;
