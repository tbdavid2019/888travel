---
name: roamradar-travel-planner
description: Autonomous travel planning agent skill for RoamRadar (888RoamTravel). Plans multi-day trips, manages itinerary segments across all 7 categories (flight, hotel, restaurant, rail, car, ride, other), and configures contingency fallback plans via RESTful API.
---

# RoamRadar Travel Planner Skill

Use this skill when tasked with researching, structuring, or managing travel itineraries in RoamRadar (888RoamTravel). This skill gives you direct RESTful API access to create and modify trips and detailed itinerary segments.

## Configuration & Headers
- **Base URL**: `https://<your-instance-domain>/api/v1`
- **Headers**:
  ```http
  Authorization: Bearer <AGENT_API_KEY>
  Content-Type: application/json
  ```

## 7 Standard Categories
Every itinerary segment must use one of the following 7 categories:
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

## Available Tool Actions & Endpoints

### 1. `list_trips`
Retrieve all existing trips to check dates or find a trip ID.
- **Method**: `GET /api/v1/trips`
- **Example Response**:
  ```json
  {
    "ok": true,
    "count": 2,
    "trips": [
      {
        "id": "t_tokyo_2026",
        "to": "NRT",
        "from": "TPE",
        "start": "2026-10-15",
        "end": "2026-10-20",
        "label": "Tokyo Autumn",
        "segmentCount": 6
      }
    ]
  }
  ```

### 2. `create_trip`
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

### 3. `get_trip`
Fetch complete trip details including all segments and notes.
- **Method**: `GET /api/v1/trips/:id`

### 4. `update_trip`
Modify trip dates, notes, or destination.
- **Method**: `PUT /api/v1/trips/:id`
- **Payload**: `{ "label": "Tokyo & Hakone Autumn", "notes": "Updated itinerary" }`

### 5. `delete_trip`
Delete a trip and its itinerary.
- **Method**: `DELETE /api/v1/trips/:id`

### 6. `add_segments` (Batch or Single)
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

### 7. `update_segment`
Update an individual itinerary item.
- **Method**: `PUT /api/v1/trips/:id/segments/:sid`
- **Payload**: `{ "note": "Updated table time to 19:00" }`

### 8. `delete_segment`
Delete a segment. Deletion is automatically tombstoned to prevent calendar/email sync resurrection.
- **Method**: `DELETE /api/v1/trips/:id/segments/:sid`

## Operational Guidelines for Agents
- When planning an entire itinerary, first call `GET /api/v1/trips` to find if a trip already exists for the dates, or create one using `POST /api/v1/trips`.
- Use the batch `POST /api/v1/trips/:id/segments` endpoint to insert the entire itinerary in a single HTTP request to optimize token efficiency and speed.
- In `note`, include key operational details such as flight times (`09:00-11:30`), confirmation codes, or booking deadlines.
