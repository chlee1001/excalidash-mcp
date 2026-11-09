# ExcaliDash MCP

English | [한국어](README.ko.md)

An MCP server that lets AI agents read and edit drawings on a self-hosted [ExcaliDash](https://github.com/ZimengXiong/ExcaliDash) instance. It runs over stdio or Streamable HTTP and talks to the drawing REST API of stable ExcaliDash releases.

Agents send semantic operations such as "add a labeled rectangle" or "connect A to B". The server applies them to the drawing and saves the result only if the drawing has not changed since it was read.

This is an independent adapter, not part of the ExcaliDash project.

```text
MCP client
    │
    ├─ stdio ───────────────┐
    │                       │
    └─ Streamable HTTP ─ ExcaliDash MCP ─ HTTPS ─ ExcaliDash
                           :9003/mcp              /api/drawings
```

## What it does

- Lists drawings and searches them by name.
- Creates empty drawings.
- Summarizes a drawing as text: bounds, element types, groups, one line per element, arrows as `"A" → "B"`, and layout warnings.
- Returns the raw JSON of one element and its bound children.
- Applies up to 50 operations as one batch. If any operation fails, nothing is saved.
- Retries a batch on a fresh copy of the drawing when another editor saved first. It gives up after three save attempts.
- Keeps the selected drawing per MCP session.

Open ExcaliDash editors receive each save, because ExcaliDash pushes saved scenes to them.

## Requirements

- ExcaliDash 0.6.0 or later. Tested with 0.6.5 and 0.6.7.
- Node.js 22 or later, or Docker Compose.
- An ExcaliDash account API key with the `Read drawings` and `Write drawings` scopes.

The server calls only the endpoints that stable ExcaliDash allows for API keys: `GET /api/drawings`, `POST /api/drawings`, and `GET` and `PUT /api/drawings/:id`. You do not need to turn on the ExcaliDash AI features.

To check that a key works, list one drawing:

```bash
curl -sS -H "Authorization: Bearer $EXCALIDASH_API_KEY" \
  'https://your-excalidash/api/drawings?limit=1'
```

A response like `{"drawings":[...],"totalCount":...}` means the key and URL are correct.

## Create an API key

1. In ExcaliDash, open **Settings > API Keys**.
2. Enter a name.
3. Select `Read drawings` and `Write drawings`.
4. Create the key and copy it. ExcaliDash shows the full key only once.

The server does not use the collection scopes.

## Run with Docker

1. Create the environment file:

   ```bash
   cp .env.example .env
   chmod 600 .env
   ```

2. Set the ExcaliDash URL and the API key in `.env`:

   ```dotenv
   EXCALIDASH_URL=https://draw.example.com
   EXCALIDASH_API_KEY=exd_your_key
   MCP_PORT=9003
   ```

   If ExcaliDash runs on the same host, use `http://host.docker.internal:6767`. Inside the container, `localhost` is the container itself.

3. Build and start the container:

   ```bash
   docker compose up -d --build
   ```

4. Check that the server is healthy:

   ```bash
   curl --fail http://127.0.0.1:9003/health
   ```

The MCP endpoint is `http://127.0.0.1:9003/mcp`. To follow the logs, run `docker compose logs -f excalidash-mcp`. To stop the server, run `docker compose down`.

Compose publishes the port on `127.0.0.1` only. The container runs as a non-root user with a read-only root filesystem and no Linux capabilities.

## Connect an MCP client

### GJC

Register the server in your user configuration:

```bash
gjc mcp add excalidash --type http --url http://127.0.0.1:9003/mcp
```

Add `--project` to write `./.gjc/mcp.json` instead. Sessions load registered servers at startup. To keep this server out of sessions that do not need it, add `"autoload": false` to its entry:

```json
{
  "mcpServers": {
    "excalidash": {
      "type": "http",
      "url": "http://127.0.0.1:9003/mcp",
      "autoload": false
    }
  }
}
```

Run `gjc mcp list` to see whether each server loads at startup.

### Other clients

Any client that supports Streamable HTTP can use `http://127.0.0.1:9003/mcp`. Most clients accept this shape:

```json
{
  "mcpServers": {
    "excalidash": {
      "type": "http",
      "url": "http://127.0.0.1:9003/mcp"
    }
  }
}
```

### Stdio

To run the server as a local process instead of a container, build it first:

```bash
npm ci
npm run build
```

Then point the client at `dist/index.js`:

```json
{
  "mcpServers": {
    "excalidash": {
      "command": "node",
      "args": ["/absolute/path/to/excalidash-mcp/dist/index.js"],
      "env": {
        "EXCALIDASH_URL": "https://draw.example.com",
        "EXCALIDASH_API_KEY": "${EXCALIDASH_API_KEY}"
      }
    }
  }
}
```

### Example prompts

```text
List my ExcaliDash drawings.

Select the "Service architecture" drawing and summarize it.

Create a drawing with an API Gateway, a Worker, and PostgreSQL, and connect them in request order.
```

## Tools

| Tool                      | What it does                                                                                             |
| ------------------------- | -------------------------------------------------------------------------------------------------------- |
| `list_drawings`           | Lists drawings, 50 per page by default and up to 200. Accepts `search`, `limit`, and `offset`.           |
| `select_drawing`          | Sets the drawing that later calls use by default.                                                        |
| `get_selected_drawing`    | Returns the selected drawing ID for this session.                                                        |
| `create_drawing`          | Creates an empty drawing and selects it unless `select` is `false`.                                      |
| `get_drawing_summary`     | Returns the text summary of a drawing.                                                                   |
| `inspect_drawing_element` | Returns one element as JSON with its bound children.                                                     |
| `apply_drawing_ops`       | Applies 1 to 50 operations as one batch and returns the saved version and the IDs it created or changed. |

`get_drawing_summary`, `inspect_drawing_element`, and `apply_drawing_ops` accept an optional `drawingId`. Without it, they use the selected drawing.

### Summary format

```text
Drawing "Architecture" (b54507c2-2879-407b-b8e0-f3fe8ec08c91) version 5, 6 elements
Bounds: (0, 0) to (580, 80), 580×80
Types: rectangle 1, text 3, ellipse 1, arrow 1
Elements:
- rectangle juM5PXi-FY8F8lgV0000 at (0, 0) 200×80 "API Gateway"
- ellipse I4bAeG9TIwvE5kPL0002 at (400, 0) 180×80 "PostgreSQL" [backgroundColor=#b2f2bb]
Connections:
- "API Gateway" juM5PXi-FY8F8lgV0000 → "PostgreSQL" I4bAeG9TIwvE5kPL0002 (arrow PuNysUewh-oifpN90004 "query")
```

Labels inside a shape or on an arrow appear on that element's line. Element lines list only styles that differ from the Excalidraw defaults, plus frame and group membership. An arrow end that is not bound to a shape appears as `(unbound)`.

A `Warnings` section lists shapes that partly overlap and labels larger than their container, up to 20 entries. A shape fully inside another shape is not reported, because panels and cards are drawn that way.

### Operations

Each operation is a JSON object with an `op` field.

| `op`              | Fields                                                        | Effect                                                                                                                                                                           |
| ----------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `add_shape`       | `shape`, `x`, `y`, optional `w`, `h`, `label`, `style`, `ref` | Adds a `rectangle`, `ellipse`, `diamond`, `text`, or `frame`. A `label` on a rectangle, ellipse, or diamond becomes text bound inside it. On a frame, it becomes the frame name. |
| `connect`         | `fromId`, `toId`, optional `label`, `style`, `arrowType`      | Draws an `arrow` (default) or a `line` between two elements and binds both ends.                                                                                                 |
| `set_text`        | `id`, `text`                                                  | Changes a text element, the label of a shape or arrow, or the name of a frame.                                                                                                   |
| `set_style`       | `id`, `style`                                                 | Changes the style of one element.                                                                                                                                                |
| `move`            | `id`, either `dx` and `dy` or `x` and `y`                     | Moves an element by an offset or to a position.                                                                                                                                  |
| `resize`          | `id`, `w`, `h`                                                | Sets the width and height.                                                                                                                                                       |
| `align`           | `ids`, `alignment`                                            | Aligns 2 to 100 elements to `left`, `center`, `right`, `top`, `middle`, or `bottom` of the first one.                                                                            |
| `distribute`      | `ids`, `direction`, optional `gap`                            | Spaces 2 to 100 elements along the `horizontal` or `vertical` axis, evenly or `gap` pixels apart.                                                                                |
| `layout`          | `ids`, `direction`, optional `gap`, `columns`, `x`, `y`       | Arranges elements in a row, a column, or a `grid`.                                                                                                                               |
| `group`           | `ids`                                                         | Puts 2 to 100 elements in a new group.                                                                                                                                           |
| `delete`          | `id`                                                          | Deletes an element and its label, and unbinds arrows attached to it.                                                                                                             |
| `import_elements` | `elements`                                                    | Adds raw Excalidraw elements and fills in missing fields.                                                                                                                        |

Moving or resizing an element also moves its label, moves the contents of a frame, and redraws the arrows attached to it.

`style` accepts only these keys: `strokeColor`, `backgroundColor`, `fillStyle` (`hachure`, `cross-hatch`, `solid`, or `zigzag`), `strokeWidth`, `strokeStyle` (`solid`, `dashed`, or `dotted`), `roughness` (0 to 2), `opacity` (0 to 100), `fontSize`, `fontFamily`, `textAlign` (`left`, `center`, or `right`), and `roundness` (`sharp` or `round`). Any other key fails the batch.

An `add_shape` with a `ref` lets later operations in the same batch use that `ref` in place of an element ID:

```json
{
  "ops": [
    {
      "op": "add_shape",
      "ref": "api",
      "shape": "rectangle",
      "x": 100,
      "y": 100,
      "w": 240,
      "h": 100,
      "label": "API Gateway"
    },
    {
      "op": "add_shape",
      "ref": "db",
      "shape": "ellipse",
      "x": 500,
      "y": 100,
      "w": 240,
      "h": 100,
      "label": "PostgreSQL"
    },
    { "op": "connect", "fromId": "api", "toId": "db", "label": "query" }
  ]
}
```

## Environment variables

| Name                    | Required | Default    | Description                                                                         |
| ----------------------- | -------- | ---------- | ----------------------------------------------------------------------------------- |
| `EXCALIDASH_URL`        | Yes      |            | Base URL of ExcaliDash. The server adds `/api` unless the URL already ends with it. |
| `EXCALIDASH_API_KEY`    | Yes      |            | Account API key with the `Read drawings` and `Write drawings` scopes.               |
| `EXCALIDASH_TOKEN`      | No       |            | Alias for `EXCALIDASH_API_KEY`. Used only when `EXCALIDASH_API_KEY` is empty.       |
| `EXCALIDASH_DRAWING_ID` | No       |            | Drawing to select when a session starts.                                            |
| `MCP_HTTP_HOST`         | No       | `0.0.0.0`  | HTTP bind address inside the container.                                             |
| `MCP_HTTP_PORT`         | No       | `8080`     | HTTP port inside the container.                                                     |
| `MCP_MAX_BODY_BYTES`    | No       | `10485760` | Largest accepted HTTP request body, in bytes.                                       |
| `MCP_MAX_SESSIONS`      | No       | `64`       | Most concurrent MCP sessions. Further sessions get HTTP 429.                        |
| `MCP_SESSION_IDLE_MS`   | No       | `1800000`  | Time in milliseconds before an idle session is closed.                              |
| `MCP_PORT`              | No       | `9003`     | Host port that Compose publishes on `127.0.0.1`.                                    |

## Security

The HTTP endpoint has no authentication of its own. Anyone who can reach it can read and edit every drawing the API key can. Keep it on `127.0.0.1`, as the Compose file does, or behind a proxy that authenticates users. Do not publish it on a LAN address such as `0.0.0.0:9003:8080`.

The server checks the `Host` and `Origin` headers on `/mcp`. That check stops DNS rebinding from a browser. It does not stop a client that connects directly, because that client can send any `Host` value.

The API key can read and change every drawing its owner has.

- Keep `.env` out of Git. The repository's `.gitignore` already excludes it.
- Keep the key out of logs, issues, and screenshots.
- If the key leaks, revoke it in ExcaliDash **Settings > API Keys** and create a new one.

## Limitations

- Each save replaces the whole scene. If a person edits the same drawing at the same time, their autosave can conflict with the agent's save. The server then re-applies the batch to the newer drawing. After three conflicts in a row, the tool returns an error.
- The server estimates text size from the character count. The editor measures text again after it loads the fonts.
- There are no tools for collections, for deleting whole drawings, or for restoring history. ExcaliDash does not accept API keys on its history endpoints.
- The selected drawing is lost when the HTTP session ends. Pass `drawingId` to avoid depending on it.

## Develop

```bash
npm ci
npm test
npm run start:http
```

`npm test` builds the project and runs the unit and integration tests. They cover the operations, the summary, conflict retries, the stdio and HTTP transports, and session limits.

`npm run test:e2e` runs the server against real ExcaliDash containers. It needs Docker. It starts the ExcaliDash backend and frontend images on a private network, creates an admin user and an API key, runs the MCP tools, and checks the saved drawing. It removes the containers when it finishes. Set `EXCALIDASH_TAG` to test another ExcaliDash version:

```bash
EXCALIDASH_TAG=0.6.5 npm run test:e2e
```

## Troubleshooting

### HTTP 401 Unauthorized

The API key is wrong or revoked. Create a new key in ExcaliDash.

### HTTP 403 Forbidden

The API key lacks the `Read drawings` or `Write drawings` scope. Drawing-scoped agent tokens from ExcaliDash 0.6.0-dev builds do not work on stable releases. Create an account API key.

### HTTP 404 or "Drawing not found"

The drawing ID is wrong, or the drawing belongs to another user. Run `list_drawings` to get the right ID.

### "Drawing changed concurrently 3 times in a row"

Someone else saved the drawing before each of the three save attempts. Wait until the other editor stops, then run the request again.

### "No drawing selected"

Call `select_drawing` after `list_drawings`, or pass `drawingId` to the tool.

### The container cannot reach ExcaliDash

`EXCALIDASH_URL` probably points to `localhost`. Inside the container, use `http://host.docker.internal:6767` for a service on the same host.

### Port 9003 is already in use

Set another port in `.env`, for example `MCP_PORT=9010`. Then change the client URL to `http://127.0.0.1:9010/mcp`.

## License

[MIT](LICENSE)
