# Gate^Flame API Connection Guide
**Ionity Global (Pty) Ltd**

The Gate^Flame dashboard connects to the underlying Pi-hole / Unbound API to fetch real-time network statistics and threat intelligence data.

## Base URL Configuration

The mobile app and the standalone web dashboard connect to the API via the Base URL configured during setup.

**Default Local Endpoint:** `http://<YOUR_PI_IP_ADDRESS>/admin/api.php`

## Authentication

All write-operations and sensitive reads require an API Token.

**Obtaining your API Token:**
1. SSH into your Master Node (Raspberry Pi).
2. Run `cat /etc/pihole/setupVars.conf | grep WEBPASSWORD`
3. Use the resulting hash as your `auth` token.

## Common Endpoints

### 1. Fetch Summary Stats
**Endpoint:** `?summaryRaw`
**Method:** `GET`
**Description:** Returns the total queries, blocked hits, and percentage.

**Example Request:**
```bash
curl "http://192.168.1.100/admin/api.php?summaryRaw"
```
**Example Response:**
```json
{
  "domains_being_blocked": 152349,
  "dns_queries_today": 14239,
  "ads_blocked_today": 3842,
  "ads_percentage_today": 26.98
}
```

### 2. Fetch Recent Blocked Queries
**Endpoint:** `?recentBlocked`
**Method:** `GET`
**Description:** Returns the most recent domain queries blocked by the engine.

### 3. Disable/Enable Engine
**Endpoint:** `?disable=<seconds>&auth=<API_TOKEN>`
**Method:** `GET`
**Description:** Temporarily disable the protection layer.

**Example Request:**
```bash
curl "http://192.168.1.100/admin/api.php?disable=300&auth=YOUR_TOKEN"
```

## Integrating with the Frontend
In `gateflame_mobile_app.html`, you can connect these endpoints by adding `fetch()` requests into the `forceUpdate()` JavaScript function, pointing the URLs to your local Pi.
