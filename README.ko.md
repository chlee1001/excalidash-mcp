# ExcaliDash MCP

[English](README.md) | 한국어

셀프호스팅한 [ExcaliDash](https://github.com/ZimengXiong/ExcaliDash)의 드로잉을 AI 에이전트가 읽고 편집하게 해 주는 MCP 서버입니다. stdio와 Streamable HTTP로 동작하고, ExcaliDash 안정판의 드로잉 REST API를 호출합니다.

에이전트는 "라벨 붙은 사각형 추가", "A와 B 연결" 같은 의미 단위 연산을 보냅니다. 서버는 연산을 드로잉에 적용하고, 읽은 뒤로 드로잉이 바뀌지 않았을 때만 결과를 저장합니다.

이 저장소는 ExcaliDash 공식 프로젝트가 아닌 독립 어댑터입니다.

```text
MCP 클라이언트
    │
    ├─ stdio ───────────────┐
    │                       │
    └─ Streamable HTTP ─ ExcaliDash MCP ─ HTTPS ─ ExcaliDash
                           :9003/mcp              /api/drawings
```

## 기능

- 드로잉 목록을 조회하고 이름으로 검색합니다.
- 빈 드로잉을 만듭니다.
- 드로잉을 텍스트로 요약합니다. 범위, 요소 종류, 그룹, 요소별 한 줄 설명, `"A" → "B"` 형식의 화살표 연결, 배치 경고가 들어갑니다.
- 요소 하나의 원본 JSON과 거기 묶인 자식 요소를 돌려줍니다.
- 연산을 최대 50개까지 한 배치로 적용합니다. 연산 하나라도 실패하면 아무것도 저장하지 않습니다.
- 다른 편집이 먼저 저장했으면 최신 드로잉을 다시 읽어 배치를 다시 적용합니다. 저장은 세 번까지 시도합니다.
- 선택한 드로잉을 MCP 세션마다 따로 기억합니다.

ExcaliDash가 저장된 장면을 열린 편집 화면에 보내 주므로, 저장할 때마다 편집 화면에도 바로 반영됩니다.

## 요구 사항

- ExcaliDash 0.6.0 이상. 0.6.5와 0.6.7에서 테스트했습니다.
- Node.js 22 이상 또는 Docker Compose
- `Read drawings`, `Write drawings` 스코프가 있는 ExcaliDash 계정 API 키

서버는 ExcaliDash 안정판이 API 키에 허용하는 엔드포인트만 호출합니다. `GET /api/drawings`, `POST /api/drawings`, `GET`·`PUT /api/drawings/:id`입니다. ExcaliDash의 AI 기능은 켜지 않아도 됩니다.

키가 동작하는지 보려면 드로잉 하나를 조회해 봅니다.

```bash
curl -sS -H "Authorization: Bearer $EXCALIDASH_API_KEY" \
  'https://your-excalidash/api/drawings?limit=1'
```

`{"drawings":[...],"totalCount":...}` 같은 응답이 오면 키와 URL이 맞습니다.

## API 키 만들기

1. ExcaliDash에서 **Settings > API Keys**를 엽니다.
2. 이름을 입력합니다.
3. `Read drawings`와 `Write drawings`를 선택합니다.
4. 키를 만들고 복사합니다. 전체 키는 한 번만 보입니다.

컬렉션 스코프는 쓰지 않습니다.

## Docker로 실행하기

1. 환경변수 파일을 만듭니다.

   ```bash
   cp .env.example .env
   chmod 600 .env
   ```

2. `.env`에 ExcaliDash URL과 API 키를 넣습니다.

   ```dotenv
   EXCALIDASH_URL=https://draw.example.com
   EXCALIDASH_API_KEY=exd_your_key
   MCP_PORT=9003
   ```

   ExcaliDash가 같은 호스트에서 돌고 있다면 `http://host.docker.internal:6767`을 씁니다. 컨테이너 안에서 `localhost`는 컨테이너 자신입니다.

3. 컨테이너를 빌드하고 시작합니다.

   ```bash
   docker compose up -d --build
   ```

4. 서버 상태를 확인합니다.

   ```bash
   curl --fail http://127.0.0.1:9003/health
   ```

MCP 엔드포인트는 `http://127.0.0.1:9003/mcp`입니다. 로그는 `docker compose logs -f excalidash-mcp`로 보고, 서버는 `docker compose down`으로 멈춥니다.

Compose는 포트를 `127.0.0.1`에만 엽니다. 컨테이너는 root가 아닌 사용자로 돌고, 루트 파일시스템은 읽기 전용이며, Linux capability는 모두 뺀 상태입니다.

## MCP 클라이언트 연결

### GJC

사용자 설정에 서버를 등록합니다.

```bash
gjc mcp add excalidash --type http --url http://127.0.0.1:9003/mcp
```

`--project`를 붙이면 `./.gjc/mcp.json`에 기록합니다. 등록한 서버는 세션이 시작될 때 함께 불러옵니다. 이 서버가 필요 없는 세션에서 불러오지 않게 하려면 항목에 `"autoload": false`를 넣습니다.

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

서버마다 시작할 때 불러오는지는 `gjc mcp list`로 확인합니다.

### 다른 클라이언트

Streamable HTTP를 지원하는 클라이언트라면 `http://127.0.0.1:9003/mcp`를 등록하면 됩니다. 대부분 이 형식을 받습니다.

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

### stdio

컨테이너 대신 로컬 프로세스로 돌리려면 먼저 빌드합니다.

```bash
npm ci
npm run build
```

그다음 클라이언트가 `dist/index.js`를 실행하게 설정합니다.

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

### 요청 예시

```text
ExcaliDash 드로잉 목록을 보여줘.

"서비스 아키텍처" 드로잉을 선택하고 요약해줘.

API Gateway, Worker, PostgreSQL이 있는 드로잉을 만들고 요청 순서대로 연결해줘.
```

## 도구

| 도구                      | 하는 일                                                                                                    |
| ------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `list_drawings`           | 드로잉 목록을 돌려줍니다. 한 페이지에 기본 50개, 최대 200개입니다. `search`, `limit`, `offset`을 받습니다. |
| `select_drawing`          | 이후 호출이 기본으로 쓸 드로잉을 정합니다.                                                                 |
| `get_selected_drawing`    | 이 세션에서 선택한 드로잉 ID를 돌려줍니다.                                                                 |
| `create_drawing`          | 빈 드로잉을 만들고 선택합니다. `select`가 `false`면 선택하지 않습니다.                                     |
| `get_drawing_summary`     | 드로잉의 텍스트 요약을 돌려줍니다.                                                                         |
| `inspect_drawing_element` | 요소 하나를 JSON으로, 묶인 자식 요소와 함께 돌려줍니다.                                                    |
| `apply_drawing_ops`       | 연산 1~50개를 한 배치로 적용하고, 저장된 버전과 새로 만들거나 바꾼 요소 ID를 돌려줍니다.                   |

`get_drawing_summary`, `inspect_drawing_element`, `apply_drawing_ops`에는 `drawingId`를 넘길 수 있습니다. 넘기지 않으면 선택한 드로잉을 씁니다.

### 요약 형식

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

도형 안이나 화살표 위의 라벨은 그 요소 줄에 함께 나옵니다. 요소 줄에는 Excalidraw 기본값과 다른 스타일만 적고, 프레임과 그룹 소속을 덧붙입니다. 도형에 묶이지 않은 화살표 끝은 `(unbound)`로 표시합니다.

`Warnings` 섹션에는 일부만 겹친 도형과 컨테이너보다 큰 라벨을 최대 20개까지 적습니다. 다른 도형 안에 통째로 들어간 도형은 적지 않습니다. 패널이나 카드를 일부러 그렇게 그리기 때문입니다.

### 연산

연산은 `op` 필드가 있는 JSON 객체입니다.

| `op`              | 필드                                                       | 동작                                                                                                                                                                                 |
| ----------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `add_shape`       | `shape`, `x`, `y`, 선택: `w`, `h`, `label`, `style`, `ref` | `rectangle`, `ellipse`, `diamond`, `text`, `frame`을 추가합니다. 사각형, 타원, 다이아몬드에 준 `label`은 도형 안에 묶인 텍스트가 됩니다. 프레임에 준 `label`은 프레임 이름이 됩니다. |
| `connect`         | `fromId`, `toId`, 선택: `label`, `style`, `arrowType`      | 두 요소 사이에 `arrow`(기본)나 `line`을 그리고 양 끝을 묶습니다.                                                                                                                     |
| `set_text`        | `id`, `text`                                               | 텍스트 요소, 도형이나 화살표의 라벨, 프레임 이름을 바꿉니다.                                                                                                                         |
| `set_style`       | `id`, `style`                                              | 요소 하나의 스타일을 바꿉니다.                                                                                                                                                       |
| `move`            | `id`, `dx`와 `dy` 또는 `x`와 `y` 중 하나                   | 요소를 거리만큼 옮기거나 지정한 좌표로 옮깁니다.                                                                                                                                     |
| `resize`          | `id`, `w`, `h`                                             | 너비와 높이를 정합니다.                                                                                                                                                              |
| `align`           | `ids`, `alignment`                                         | 요소 2~100개를 첫 요소의 `left`, `center`, `right`, `top`, `middle`, `bottom`에 맞춥니다.                                                                                            |
| `distribute`      | `ids`, `direction`, 선택: `gap`                            | 요소 2~100개를 `horizontal` 또는 `vertical` 방향으로 같은 간격, 또는 `gap` 픽셀 간격으로 늘어놓습니다.                                                                               |
| `layout`          | `ids`, `direction`, 선택: `gap`, `columns`, `x`, `y`       | 요소를 한 줄, 한 열, 또는 `grid`로 배치합니다.                                                                                                                                       |
| `group`           | `ids`                                                      | 요소 2~100개를 새 그룹으로 묶습니다.                                                                                                                                                 |
| `delete`          | `id`                                                       | 요소와 그 라벨을 지우고, 거기 붙은 화살표의 연결을 풉니다.                                                                                                                           |
| `import_elements` | `elements`                                                 | Excalidraw 요소 원본을 추가하고 빠진 필드를 채웁니다.                                                                                                                                |

요소를 옮기거나 크기를 바꾸면 라벨이 함께 움직이고, 프레임 안의 요소도 따라 움직이며, 붙어 있는 화살표는 다시 그려집니다.

`style`은 다음 키만 받습니다. `strokeColor`, `backgroundColor`, `fillStyle`(`hachure`, `cross-hatch`, `solid`, `zigzag`), `strokeWidth`, `strokeStyle`(`solid`, `dashed`, `dotted`), `roughness`(0~2), `opacity`(0~100), `fontSize`, `fontFamily`, `textAlign`(`left`, `center`, `right`), `roundness`(`sharp`, `round`). 다른 키가 있으면 배치 전체가 실패합니다.

`add_shape`에 `ref`를 주면 같은 배치의 뒤 연산에서 요소 ID 대신 그 `ref`를 쓸 수 있습니다.

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

## 환경변수

| 이름                    | 필수   | 기본값     | 설명                                                                       |
| ----------------------- | ------ | ---------- | -------------------------------------------------------------------------- |
| `EXCALIDASH_URL`        | 예     |            | ExcaliDash 기본 URL. URL이 `/api`로 끝나지 않으면 서버가 붙입니다.         |
| `EXCALIDASH_API_KEY`    | 예     |            | `Read drawings`, `Write drawings` 스코프가 있는 계정 API 키                |
| `EXCALIDASH_TOKEN`      | 아니요 |            | `EXCALIDASH_API_KEY`의 별칭. `EXCALIDASH_API_KEY`가 비어 있을 때만 씁니다. |
| `EXCALIDASH_DRAWING_ID` | 아니요 |            | 세션이 시작될 때 선택할 드로잉                                             |
| `MCP_HTTP_HOST`         | 아니요 | `0.0.0.0`  | 컨테이너 안 HTTP 바인드 주소                                               |
| `MCP_HTTP_PORT`         | 아니요 | `8080`     | 컨테이너 안 HTTP 포트                                                      |
| `MCP_MAX_BODY_BYTES`    | 아니요 | `10485760` | 받을 수 있는 HTTP 요청 본문의 최대 크기(바이트)                            |
| `MCP_MAX_SESSIONS`      | 아니요 | `64`       | 동시 MCP 세션 수 상한. 넘으면 HTTP 429를 돌려줍니다.                       |
| `MCP_SESSION_IDLE_MS`   | 아니요 | `1800000`  | 쓰지 않는 세션을 닫기까지 기다리는 시간(밀리초)                            |
| `MCP_PORT`              | 아니요 | `9003`     | Compose가 `127.0.0.1`에 여는 호스트 포트                                   |

## 보안

HTTP 엔드포인트에는 자체 인증이 없습니다. 엔드포인트에 접근할 수 있는 사람은 API 키로 볼 수 있는 모든 드로잉을 읽고 고칠 수 있습니다. Compose 파일처럼 `127.0.0.1`에만 열어 두거나, 사용자를 인증하는 프록시 뒤에 두십시오. `0.0.0.0:9003:8080`처럼 LAN 주소에 열지 마십시오.

서버는 `/mcp` 요청의 `Host`와 `Origin` 헤더를 검사합니다. 이 검사는 브라우저를 통한 DNS 리바인딩을 막습니다. 직접 접속하는 클라이언트는 `Host` 값을 마음대로 보낼 수 있어서 막지 못합니다.

API 키는 키 주인의 드로잉을 모두 읽고 바꿀 수 있습니다.

- `.env`를 Git에 올리지 마십시오. 저장소의 `.gitignore`가 이미 제외합니다.
- 로그, 이슈, 스크린샷에 키를 남기지 마십시오.
- 키가 노출되면 ExcaliDash **Settings > API Keys**에서 폐기하고 새로 만드십시오.

## 제한 사항

- 저장할 때마다 장면 전체를 덮어씁니다. 사람이 같은 드로잉을 동시에 편집하면 그 사람의 자동 저장과 에이전트의 저장이 충돌할 수 있습니다. 이때 서버는 더 새로운 드로잉에 배치를 다시 적용합니다. 세 번 연속 충돌하면 도구가 오류를 돌려줍니다.
- 텍스트 크기는 글자 수로 어림합니다. 편집 화면은 글꼴을 불러온 뒤 크기를 다시 잽니다.
- 컬렉션 관리, 드로잉 자체 삭제, 히스토리 복원 도구는 없습니다. ExcaliDash 히스토리 엔드포인트가 API 키를 받지 않습니다.
- HTTP 세션이 끝나면 선택한 드로잉도 사라집니다. 선택 상태에 기대지 않으려면 `drawingId`를 넘기십시오.

## 개발

```bash
npm ci
npm test
npm run start:http
```

`npm test`는 프로젝트를 빌드하고 단위 테스트와 통합 테스트를 돌립니다. 연산, 요약, 충돌 재시도, stdio와 HTTP 전송, 세션 상한을 확인합니다.

`npm run test:e2e`는 실제 ExcaliDash 컨테이너를 상대로 서버를 돌립니다. Docker가 필요합니다. ExcaliDash 백엔드와 프론트엔드 이미지를 전용 네트워크에 띄우고, 관리자와 API 키를 만들고, MCP 도구를 실행한 뒤 저장된 드로잉을 확인합니다. 끝나면 컨테이너를 지웁니다. 다른 ExcaliDash 버전을 테스트하려면 `EXCALIDASH_TAG`를 지정합니다.

```bash
EXCALIDASH_TAG=0.6.5 npm run test:e2e
```

## 문제 해결

### HTTP 401 Unauthorized

API 키가 틀렸거나 폐기됐습니다. ExcaliDash에서 새 키를 만드십시오.

### HTTP 403 Forbidden

API 키에 `Read drawings`나 `Write drawings` 스코프가 없습니다. ExcaliDash 0.6.0-dev 빌드의 드로잉 전용 에이전트 토큰은 안정판에서 동작하지 않습니다. 계정 API 키를 만드십시오.

### HTTP 404 또는 "Drawing not found"

드로잉 ID가 틀렸거나 다른 사용자의 드로잉입니다. `list_drawings`로 올바른 ID를 확인하십시오.

### "Drawing changed concurrently 3 times in a row"

세 번 저장을 시도하는 동안 매번 다른 사람이 먼저 저장했습니다. 다른 편집이 끝난 뒤 다시 요청하십시오.

### "No drawing selected"

`list_drawings` 다음에 `select_drawing`을 호출하거나, 도구에 `drawingId`를 넘기십시오.

### 컨테이너가 ExcaliDash에 접속하지 못함

`EXCALIDASH_URL`이 `localhost`를 가리키고 있을 가능성이 큽니다. 같은 호스트의 서비스라면 컨테이너 안에서는 `http://host.docker.internal:6767`을 쓰십시오.

### 9003 포트를 이미 쓰고 있음

`.env`에서 다른 포트를 지정합니다. 예를 들어 `MCP_PORT=9010`으로 바꾼 뒤 클라이언트 URL도 `http://127.0.0.1:9010/mcp`로 바꾸십시오.

## 라이선스

[MIT](LICENSE)
