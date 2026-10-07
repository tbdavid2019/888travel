---
name: 888travel-planner
description: Comprehensive autonomous travel planning, itinerary management, Google Places exploration, contingency fallback orchestration, and wishlist radar skill for 888travel.
---

# 888travel Travel Planner Skill

Use this skill when tasked with researching, structuring, modifying, or managing travel itineraries in 888travel. This skill gives you direct RESTful API access to manage multi-day trips, granular itinerary items, Google Places discovery, contingency fallback plans, wishlist radar, backups, and synchronizations.

## Configuration & Headers
- **Base URL**: `https://<your-instance-domain>/api/v1`
- **Headers**:
  ```http
  Authorization: Bearer <AGENT_API_KEY>
  Content-Type: application/json
  ```

## 7 Standard Categories
Every itinerary segment must strictly use one of the following 7 categories:
1. `flight` ✈️: Flights, connections, airport departure/arrival.
2. `hotel` 🏨: Accommodations, hotels, ryokans, resorts, Airbnbs.
3. `restaurant` 🍽️: Dining, restaurants, food stalls, cafes, bars.
4. `rail` 🚆: Trains, Shinkansen, high-speed rail, subways.
5. `car` 🚗: Rental cars, car hire pick-up and drop-off.
6. `ride` 🚕: Taxis, airport transfers, ride-hailing services.
7. `other` 📍: Sightseeing attractions, museums, activities, meetings.

## Contingency & Fallback Plans
Travelers encounter unexpected queues, closures, and weather changes. Whenever proposing restaurants or outdoor activities, attach a viable alternative in the `fallback` object:
```json
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
```

---

## Available Tool Actions & Endpoints

### 1. `get_status`
Check instance health, version, trip counts, and active integration flags.
- **Method**: `GET /api/v1/status`

### 2. `list_trips`
Retrieve all existing trips to check dates or find a trip ID.
- **Method**: `GET /api/v1/trips`

### 3. `get_trip`
Fetch complete trip details including all segments and notes.
- **Method**: `GET /api/v1/trips/:id`

### 4. `create_trip`
Create a new multi-day trip container.
- **Method**: `POST /api/v1/trips`
- **Payload**:
  ```json
  {
    "from": "TPE",
    "to": "NRT",
    "start": "2026-10-15",
    "end": "2026-10-20",
    "label": "Tokyo Autumn Voyage",
    "timezone": "Asia/Tokyo",
    "notes": "Autumn trip to Tokyo and Hakone"
  }
  ```

### 5. `update_trip`
Modify trip dates, destination, notes, timezone, or photo.
- **Method**: `PUT /api/v1/trips/:id`

### 6. `delete_trip`
Delete a trip and its entire itinerary.
- **Method**: `DELETE /api/v1/trips/:id`

### 7. `add_segments` (Batch or Single)
Add itinerary items to a trip. Pass an array of items for high-performance batch creation.
- **Method**: `POST /api/v1/trips/:id/segments`
- **Payload**:
  ```json
  [
    {
      "type": "flight",
      "name": "BR198 TPE to NRT",
      "start": "2026-10-15T08:50",
      "end": "2026-10-15T13:15",
      "note": "Terminal 2, Seat 12A",
      "conf": "BR-78910"
    },
    {
      "type": "restaurant",
      "name": "Ginza Kagari Ramen",
      "address": "6-4-12 Ginza, Chuo-ku, Tokyo",
      "start": "2026-10-15T18:00",
      "note": "Famous Tori Paitan ramen",
      "fallback": {
        "name": "Kyushu Jangara Ginza",
        "address": "6-12-1 Ginza, Chuo-ku, Tokyo",
        "note": "Quick tonkotsu backup"
      }
    }
  ]
  ```

### 8. `update_segment`
Update an individual itinerary item.
- **Method**: `PUT /api/v1/trips/:id/segments/:sid`

### 9. `delete_segment`
Delete a segment. Deletion is automatically tombstoned to prevent calendar/email sync resurrection.
- **Method**: `DELETE /api/v1/trips/:id/segments/:sid`

### 10. `swap_fallback`
1-Click Contingency Swap: Promotes the configured fallback plan to primary and sets the former primary as fallback.
- **Method**: `POST /api/v1/trips/:id/segments/:sid/swap-fallback`

### 11. `search_places`
Search Google Places for verified venues, ratings, review counts, and open status.
- **Method**: `POST /api/v1/places/search`
- **Payload**:
  ```json
  {
    "query": "Ginza Kagari Ramen",
    "language": "zh-TW"
  }
  ```

### 12. `get_place_details`
Retrieve operating hours, phone, website, and location details for a Google Place ID.
- **Method**: `POST /api/v1/places/details`
- **Payload**:
  ```json
  {
    "placeId": "ChIJb7c_..."
  }
  ```

### 13. `list_wishes`
List tracked travel wishlist destinations, preferred months, and budgets.
- **Method**: `GET /api/v1/wishes`

### 14. `add_wish`
Add or update a travel wishlist item.
- **Method**: `POST /api/v1/wishes`
- **Payload**:
  ```json
  {
    "from": "TPE",
    "dest": "KIX",
    "days": "6",
    "month": "November",
    "budget": "NT$35,000",
    "note": "Autumn foliage direct flight"
  }
  ```

### 15. `delete_wish`
Delete a wishlist radar item.
- **Method**: `DELETE /api/v1/wishes/:id`

### 16. `trigger_sync`
Trigger on-demand background sync with Google Calendar and Gmail.
- **Method**: `POST /api/v1/sync`

### 17. `list_backups`
List automated cloud snapshot backups.
- **Method**: `GET /api/v1/backups`

### 18. `export_data`
Download full instance JSON export.
- **Method**: `GET /api/v1/export`

### 19. `chat_copilot`
Query 888travel's internal AI copilot with active trip context.
- **Method**: `POST /api/v1/copilot/chat`
- **Payload**:
  ```json
  {
    "currentTripId": "t_tokyo_2026",
    "messages": [
      { "role": "user", "content": "Suggest a dinner spot near Shinjuku with a fallback." }
    ]
  }
  ```

---

## Operational Guidelines for Agents
- When planning an entire itinerary, first call `GET /api/v1/trips` to find if a trip already exists for the dates, or create one using `POST /api/v1/trips`.
- Use the batch `POST /api/v1/trips/:id/segments` endpoint to insert the entire itinerary in a single HTTP request to optimize token efficiency and speed.
- In `note`, include key operational details such as flight times (`09:00-11:30`), confirmation codes, or booking deadlines.
- Use `search_places` before adding dining or attractions to ensure accurate names, ratings, and addresses.
