# Orglet: Kế hoạch triển khai MVP

**Ngày:** 14/09/2026  
**Trạng thái:** Đề xuất triển khai v0.1, chưa phải sản phẩm đã xây hoặc benchmark đã đạt  
**Nền tảng ưu tiên:** Windows desktop, local-first, một người sử dụng  
**Hướng giao diện:** Tối giản theo cách tương tác của ChatGPT, dùng thương hiệu Orglet riêng  
**Luồng kiểm chứng đầu tiên:** Eris Review Team

> Giao việc cho một worker hoặc một team. Orglet giữ quy trình, kỹ năng, bằng chứng và lịch sử; model là phần có thể thay.

## 1. Quyết định sản phẩm

Orglet v0.1 là **workspace làm việc với AI**, không phải trình giả lập công ty và không phải dashboard bọc một coding harness.

Một người có thể dùng một worker độc lập, tạo team nhỏ, rồi mở rộng thành company khi thực sự cần. V0.1 hoàn thiện Worker và Team; Company là bước tiếp theo, không phải bước onboarding bắt buộc.

Ba điều MVP phải chứng minh:

1. Một bộ instructions/skills được lưu và quản lý trong Orglet, dùng lại được qua nhiều nhiệm vụ và ít nhất hai provider.
2. Team tạo ra một kết quả chung có bằng chứng, thay vì bắt người dùng đọc và ghép nhiều cuộc chat.
3. Người dùng biết việc đang đến đâu, đang tốn gì, cần duyệt gì và có thể tiếp tục sau gián đoạn.

**Câu mô tả cho landing page:** `Your AI team, one place to work.`

**Không hứa:** AI tự xây doanh nghiệp có lãi; đổi model vẫn giữ nguyên chất lượng; subscription của mọi hãng đều dùng được như API; agent hoạt động khi máy đã tắt.

## 2. Ranh giới MVP

| Có trong v0.1 | Để sau v0.1 |
|---|---|
| Worker độc lập và Team độc lập | Company nhiều phòng ban, CEO tự điều hành |
| Chat để giao việc, task state và artifact riêng | Office 3D, avatar động, social feed nhân viên |
| Instructions/skills versioned, app-owned | Marketplace công khai và tự tải/chạy skill lạ |
| Native agent loop qua OpenAI API và Anthropic API | Tích hợp tất cả provider/harness |
| Adapter Codex chính thức, giới hạn khả năng rõ ràng | Claude subscription bridge đại trà |
| Workflow tuần tự và song song rồi tổng hợp | Canvas node kéo thả, debate tự do, swarm động |
| Budget API, theo dõi quota khả dụng, allocation nội bộ | Payroll thật, tự tuyển/sa thải, ngân hàng, MRR/ROI tự suy diễn |
| Checkpoint, pause/cancel, approval và run history | Distributed scheduler, cloud worker chạy 24/7 |
| Routine hằng ngày/tuần đơn giản, chỉ chạy khi app hoạt động | Event bus đa dịch vụ và mọi kiểu webhook |
| Eris Review template + Blank Team + Research/Review template nhẹ | Tự submit, tự approve challenge trên nền tảng Eris |

Không làm một engine dành riêng cho Eris. Eris phải được biểu diễn bằng template, skill và output schema; core không có các nhánh `if team.name === 'Eris'`.

### Mốc cắt phạm vi

Bản dogfood đầu tiên cần native API, một worker, task bền vững và artifact. Bản MVP phát hành tiếp theo mới yêu cầu team orchestration, provider thứ hai, budget, Eris và kiểm thử Codex adapter. Company UI không nằm trên đường găng này.

## 3. Trải nghiệm người dùng cốt lõi

### 3.1 Lần mở đầu

Không yêu cầu tài khoản Orglet, tên công ty hoặc chức danh CEO.

Luồng: **mở app → kết nối model → chọn Worker/Team template → giao việc đầu tiên**.

Cho phép xem một nhiệm vụ mẫu trước khi kết nối. Dữ liệu mẫu có nhãn `Demo`, không trộn vào usage thật. API key hoặc đăng nhập provider là thao tác có chủ ý của người dùng.

Màn kết nối chỉ hiển thị những integration thực sự hoạt động. Không có nút Claude subscription hoặc provider giả để trang trí.

### 3.2 Giao việc

Ví dụ người dùng chọn `Eris Review`, đính kèm một thư mục challenge và nhập:

> Review challenge này theo checklist của tôi. Chỉ tạo báo cáo và draft feedback, không sửa hoặc submit gì lên Eris.

Orglet tạo một task bền vững. Cùng một thread có thể có nhiều lần thử; mỗi lần thử có run ID, phiên bản instructions, danh sách nguồn và ledger riêng.

Nếu phạm vi và quyền đã được cấp cho template, công việc đọc/phân tích bắt đầu ngay. Không thêm hộp xác nhận cho mọi thao tác an toàn.

Nếu thiếu dữ liệu quan trọng, hiện một câu hỏi tập trung ngay trong task, ví dụ:

> Chưa có run logs nên chưa thể kết luận độ ổn định. Tiếp tục review dataset trước hay bổ sung logs?

Những phần độc lập vẫn có thể chạy. Phần thiếu bằng chứng được đánh dấu `chưa đánh giá`, không tự đổi thành PASS.

### 3.3 Trong khi chạy

Người dùng thấy tiến độ ngắn: `Đã kiểm tra schema`, `Đang phân tích kết quả chạy`, `Cần bạn xác nhận nguồn dữ liệu`.

Không stream hội thoại nội bộ của ba bot vào màn hình chính. Chi tiết tool calls, worker events và lỗi nằm trong panel Activity. Hiển thị hành động và bằng chứng, không yêu cầu model tiết lộ suy nghĩ nội bộ.

Nút `Tạm dừng` ngừng cấp công việc mới ở ranh giới an toàn. Nút `Hủy` gửi yêu cầu hủy và giữ kết quả đã có. Một request đã gửi đi có thể vẫn bị provider tính phí; UI không hứa hoàn tiền.

### 3.4 Kết quả

Hiển thị một câu trả lời tổng hợp cùng artifact `Review report`, bảng finding có source references, các mục chưa kiểm tra và draft feedback ngắn.

Nút chính: `Chấp nhận bản review`. Nút phụ: `Yêu cầu xem lại`, `Sao chép feedback`, `Xuất Markdown`.

**Chấp nhận bản review trong Orglet không đồng nghĩa approve challenge trên Eris.** V0.1 không có quyền gửi hoặc thay đổi dữ liệu bên ngoài.

## 4. UI/UX: giống cách dùng ChatGPT, không giống dashboard quản trị

### 4.1 Layout

```text
┌──────────────────┬─────────────────────────────────────────┐
│ Orglet           │ Eris Review ▾                Chi tiết   │
│                  │                                         │
│ + Công việc mới  │ Bạn: Review challenge này...            │
│ Tìm kiếm         │                                         │
│                  │ Orglet                                  │
│ TEAMS            │ Đã xong 2/3 bước. Còn thiếu run logs.    │
│ Eris Review      │                                         │
│ Research         │ ┌ Báo cáo review ─────────────────────┐ │
│                  │ │ 2 vấn đề có bằng chứng              │ │
│ WORKERS          │ │ 1 mục chưa đủ dữ liệu               │ │
│ Researcher       │ │ Xem nguồn · Mở báo cáo              │ │
│                  │ └─────────────────────────────────────┘ │
│ GẦN ĐÂY          │                                         │
│ Review #...      │ ┌─────────────────────────────────────┐ │
│ Research ...     │ │ Giao việc hoặc hỏi tiếp...          │ │
│                  │ │ + Tệp     Eris Review ▾      Gửi ↑  │ │
│ Thư viện         │ └─────────────────────────────────────┘ │
│ Cài đặt          │                                         │
└──────────────────┴─────────────────────────────────────────┘
```

Sidebar rộng mặc định 248 px, thu gọn được. Nội dung trung tâm có max-width khoảng 780 px; không trải text tràn màn hình lớn. Composer nằm cuối luồng.

Panel phải chỉ mở khi cần, rộng mặc định 360 px: `Kết quả`, `Hoạt động`, `Thiết lập`. Ở cửa sổ hẹp, dùng drawer overlay thay vì ép ba cột nhỏ. Main pane vẫn đọc được ở cửa sổ 1024×768 và màn hình 1366×768.

Trang mới chỉ có câu `Bạn muốn giao việc gì?`, composer và tối đa ba gợi ý template. Không có dashboard token, biểu đồ org chart hoặc onboarding dài.

### 4.2 Màu sắc và typography

Đây là token đề xuất cho Orglet, không phải khẳng định các mã màu chính thức của ChatGPT.

| Token | Light | Dark |
|---|---|---|
| Background | `#FFFFFF` | `#212121` |
| Sidebar | `#F7F7F8` | `#171717` |
| Surface | `#F1F1F1` | `#2F2F2F` |
| Text | `#1F1F1F` | `#ECECEC` |
| Muted text | `#666666` | `#B4B4B4` |
| Border | `#E5E5E5` | `#404040` |
| Primary button | `#171717` | `#ECECEC` |
| Primary label | `#FFFFFF` | `#171717` |

Dùng system font, ưu tiên Segoe UI trên Windows. Body 15–16 px, line-height khoảng 1.55; code 13 px. Spacing theo bội số 4; controls cao khoảng 36–40 px; corner radius 10–14 px, composer khoảng 24 px.

Màu xanh/đỏ/vàng chỉ dành cho trạng thái và luôn có chữ/icon đi kèm. Không dùng gradient, glassmorphism, neon, emoji làm icon chủ đạo, logo OpenAI hoặc font độc quyền của họ.

Default theme theo hệ điều hành; cho chọn Light/Dark/System. Dùng shadcn/ui làm nền component rồi sửa token và spacing để thống nhất; cách phân phối component của shadcn cho phép chỉnh source trực tiếp.[^shadcn]

### 4.3 Các màn thực sự cần

| Màn | Chức năng |
|---|---|
| New task / Task thread | Giao việc, hỏi tiếp, xem trạng thái, nhận kết quả |
| Team settings | Purpose, members, workflow preset, instructions, resources |
| Worker settings | Role, instructions, skills, model connection, quyền |
| Library | Skills và knowledge đã được người dùng xác nhận |
| Settings | Connections, Usage & limits, appearance, export/backup |

Không tạo trang riêng cho mỗi khái niệm trong database. Tạo/chỉnh worker và team bằng drawer, không bắt chuyển qua nhiều wizard.

Advanced settings ẩn mặc định: output schema, retry policy, context budget, tool constraints. Người dùng chỉ cần đặt tên, mô tả việc, chọn skill và connection.

### 4.4 Trạng thái và thao tác

Phải thiết kế từ đầu các trạng thái: trống, chưa kết nối model, đang chạy, mất mạng, đang đợi quota, cần thông tin, cần duyệt, lỗi một phần, bị hủy và hoàn tất.

Không chỉ hiện `Something went wrong`. Lỗi phải nói bước nào lỗi, kết quả nào đã giữ được và hành động tiếp theo.

Hỗ trợ bàn phím: Ctrl+K tìm/chuyển task; Ctrl+N task mới; Enter gửi; Shift+Enter xuống dòng. Không gửi khi người dùng còn đang nhập bằng IME. Focus ring rõ; không tự cuộn xuống khi người dùng đang đọc đoạn trên. Tôn trọng reduced motion.

Mục tiêu kiểm thử contrast: ít nhất 4.5:1 cho body text; không tự tuyên bố đạt chuẩn accessibility trước khi kiểm thử.

## 5. Kiến trúc triển khai

### 5.1 Stack chốt cho MVP

| Lớp | Lựa chọn đề xuất | Lý do trong kế hoạch |
|---|---|---|
| Desktop | Electron + Electron Forge | Một codebase TypeScript cho UI và runtime; ưu tiên triển khai Windows |
| UI | React + TypeScript + Vite + Tailwind + shadcn/ui | Dễ sửa trực tiếp design system và component |
| Local core | TypeScript trong utility process | Tách orchestration khỏi luồng UI |
| State | SQLite, migrations, WAL, một owner ghi | Task, queue, version và ledger ở local |
| Search | SQLite FTS5 | Bắt đầu bằng tìm kiếm có phạm vi, chưa cần vector database |
| Providers | Official OpenAI SDK + Anthropic SDK, adapter mỏng | Orglet sở hữu agent loop, không phụ thuộc harness |
| Data audit | Trusted CSV/JSON validators; DuckDB Node cho Parquet/CSV | Chỉ chạy checker đóng gói sẵn, không chạy code challenge |
| Tests | Vitest + UI tests + desktop smoke/E2E | Tách deterministic tests khỏi eval dùng model thật |

Không thêm Redis, Kubernetes, microservices, server account hay hosted database cho bản đầu. Không cần WSL cho luồng native. Dependency được pin bằng lockfile; kiểm thử packaged build trên Windows sạch.

Electron có utility process với Node.js và message ports để tách công việc khỏi UI.[^utility] SQLite FTS5 cung cấp full-text search; WAL cho phép reader/writer cùng tiến hành, nhưng không phải database nhiều writer song song.[^fts][^wal]

Với SQLite WAL, kiểm tra **version của engine thực sự được bundle**, không chỉ version npm wrapper. Tài liệu SQLite ghi bản sửa WAL-reset bug ở 3.51.3 và một số backport; dùng một bản đã chứa fix.[^wal]

DuckDB Node client là lựa chọn kỹ thuật cần kiểm thử native packaging ngay ở milestone đầu. Không mở arbitrary SQL cho LLM; checker dùng query templates và file handles đã được cấp phép.[^duckdb]

### 5.2 Ranh giới sở hữu

```text
React UI
   │ typed IPC
Electron main: OS dialogs, credential storage, lifecycle
   │ validated messages
Orglet Core
   ├── instructions + skills + knowledge revisions
   ├── task/run/step state machine
   ├── team orchestration
   ├── policy gate + approval
   ├── budget reservations + scheduler
   └── artifacts + evidence + audit events
          │
          ├── Native API runtime → OpenAI / Anthropic
          └── Optional runtime adapter → Codex app-server
```

Renderer không giữ API key, không đọc trực tiếp toàn bộ filesystem và không gọi database. Core chạy sau UI, nhưng không được đồng nhất với một sandbox cho code tùy ý.

Orglet sở hữu **business policy và state**. Provider/harness vẫn có giới hạn hệ thống của chính họ; app không thể ghi đè chúng bằng instruction.

### 5.3 Cấu trúc repository

```text
orglet/
  apps/desktop/
    src/main/              # lifecycle, credentials, typed IPC
    src/preload/           # minimal allowed bridge
    src/renderer/          # React UI
    src/core/
      domain/              # worker, team, task, run, finding
      context/             # instruction compiler, retrieval
      orchestration/       # fixed workflow engine
      policies/            # tool scopes, approval rules
      budgets/             # reservations, ledger, fairness
      storage/             # SQLite schema, migrations, repositories
      tools/               # trusted readers/profilers
      adapters/            # native APIs, optional Codex
  templates/
    eris-review/
    research-review/
  tests/
    fixtures/
    unit/
    integration/
    e2e/
    evals/
  docs/
```

Một modular monolith, không tách mỗi thư mục thành package publish riêng. Interface chỉ đặt ở những ranh giới thực sự cần thay thế.

## 6. Data model và source of truth

Workspace là phạm vi kỹ thuật cho dữ liệu và quyền, **không phải Company bắt buộc**.

| Entity | Vai trò |
|---|---|
| Workspace | Phạm vi dữ liệu, quyền, kết nối, policy chung |
| Worker | Identity, role contract mặc định, instructions, skill bindings |
| Team | Purpose, member bindings, workflow, budget và knowledge scope |
| Team membership | Worker tham gia team với role/permission overrides có kiểm soát |
| Instruction revision / Skill version | Nội dung bất biến theo phiên bản |
| Thread / Message | Hội thoại để người dùng tương tác |
| Task | Mục tiêu công việc tồn tại độc lập với một lần chạy |
| Run / Step attempt | Một lần thực thi task và các bước con |
| Artifact / Finding | Kết quả có schema, nguồn, checksum, creator/run metadata |
| Approval request | Action chính xác, args hash, scope, expiry và kết quả duyệt |
| Connection | Provider/auth mode/capabilities; chỉ lưu secret reference |
| Budget / Reservation / Ledger entry | Giới hạn, ngân sách giữ chỗ và chi phí thực tế/ước tính |
| Routine | Lịch, timezone, next due time và cách xử lý missed run |
| Knowledge item | Ghi chú đã xác nhận, provenance, scope, phiên bản |

Worker có thể tham gia nhiều team; không biến reporting tree thành execution graph. Knowledge của team A không tự động lọt vào team B chỉ vì chung worker.

V0.2 có thể thêm Company và membership của team bằng migration thông thường. Không cần viết lại Worker hoặc Task, nhưng không hứa rằng mở rộng schema sẽ không có migration nào.

### Canonical state

Database giữ revision metadata, quan hệ và trạng thái. Blob/artifact lớn được lưu trong thư mục dữ liệu app theo content hash. Dataset nguồn không nhất thiết sao chép toàn bộ: dùng manifest gồm path, size, fingerprint/hash và quyền đọc; ghi rõ mức kiểm chứng snapshot.

Sửa instructions tạo phiên bản mới; run đang chạy giữ nguyên bản snapshot. Thay đổi quyền để thu hồi quyền có hiệu lực ngay ở policy gate, kể cả run cũ.

`AGENTS.md`, `CLAUDE.md` hoặc context files xuất cho adapter chỉ là artifact sinh ra trong execution directory riêng. Không tự ghi đè cấu hình trong repo gốc hoặc thư mục home của người dùng.

## 7. Instructions, skills và memory

### 7.1 Context compiler

```text
Platform/provider safety constraints
            +
Workspace policy
            +
Team instructions, nếu có
            +
Role contract và worker settings
            +
Task brief, selected skill versions, relevant evidence
            ↓
Provider-compatible execution request
```

Đây không phải cơ chế nối tất cả Markdown thành một prompt dài. Compiler phải deduplicate, chọn đúng phạm vi và lưu manifest: đã nạp bản nào, nguồn nào, cắt bỏ gì vì context limit.

Quyền tool được kiểm tra bằng code. Instructions không được dùng để cấp quyền, nâng ngân sách hoặc vô hiệu hóa approval. Tài liệu bên ngoài là dữ liệu không đáng tin, không được đổi policy.

### 7.2 Skill format

Dùng cấu trúc Agent Skills để thuận lợi import/export: `SKILL.md` với YAML frontmatter, cùng references/assets khi cần.[^skills]

Orglet bổ sung manifest riêng cho `input_schema`, `output_schema`, `required_permissions`, `evaluator`, `version_hash`. Không giả định mọi runtime hiểu metadata bổ sung này.

V0.1 chỉ tự thực thi trusted built-in tools. Skill tải ngoài được import để review nội dung; scripts không tự chạy. Capability yêu cầu nhưng runtime không hỗ trợ phải hiện lỗi rõ, không âm thầm bỏ qua.

### 7.3 Ba loại memory

**Run state:** trạng thái tác vụ hiện tại và handoff. Tự lưu.

**Evidence/artifacts:** sự kiện và kết quả gắn với nguồn. Có scope theo task/team.

**Reusable knowledge:** nguyên tắc hoặc phát hiện đáng dùng lại. Agent có thể đề xuất, nhưng người dùng duyệt trước khi trở thành instruction/knowledge lâu dài.

MVP dùng keyword search, tags, pinned knowledge và lọc scope. Chưa cần memory agent tự sửa policy hoặc RAG phức tạp. Model mới nhận brief và bằng chứng được chọn; không hứa chuyển nguyên trạng hidden reasoning của model cũ.

## 8. Team orchestration và durability

### 8.1 Hai workflow presets

**Tuần tự:** Worker A → Worker B kiểm tra → kết quả.

**Song song rồi tổng hợp:** A/B/C làm các phần độc lập → aggregator → người dùng.

Không bắt buộc manager agent. Scheduler bằng code quyết định dependency, retry và join. Một role tổng hợp chỉ được gọi khi có nội dung cần tổng hợp.

Concurrency cấu hình được nhưng mặc định bảo thủ. Trên một subscription connection, bắt đầu với một execution đồng thời để giảm tranh quota và đơn giản hóa accounting; parallel graph vẫn có thể xếp hàng hoặc chạy trên connection khác.

### 8.2 Shared state

Mỗi worker ghi finding riêng có `finding_id`, category, severity, source references, check coverage, recommendation và writer/run ID. Core validate schema rồi commit; aggregator đọc revision đã khóa ở join barrier.

Không cho nhiều worker overwrite cùng một `review.json`. Finding mâu thuẫn phải giữ cả hai và tạo mục cần phân xử, không xóa ý kiến trước đó bằng last-write-wins.

Ví dụ trạng thái:

```yaml
schema_version: 1
review:
  challenge_id: demo-001
  checks:
    submission_schema:
      status: pass
      evidence_refs: [artifact-schema-01]
    score_stability:
      status: not_assessed
      reason: missing_run_logs
  findings: []
  recommendation: insufficient_evidence
  human_review_status: draft
```

### 8.3 State machine

```text
queued → running → completed
            ├→ waiting_for_input → queued
            ├→ waiting_for_approval → queued
            ├→ waiting_for_budget → queued
            ├→ paused → queued
            ├→ partial
            ├→ failed
            └→ canceled
```

Lưu step attempt, lease/heartbeat, checkpoint và event sequence vào SQLite. Khi app mở lại, stale lease không tự biến thành success; run chuyển `interrupted` để reconcile rồi đề xuất resume.

Step đã commit thành công được dùng lại. Lệnh đọc có thể retry; external side effect không tự replay nếu không biết đã thành công hay chưa. Không hứa exactly-once cho một dịch vụ bên ngoài không hỗ trợ idempotency.

Instruction update hoặc thay nguồn phải tạo run revision/attempt mới. Không sửa lịch sử bằng chứng của run cũ.

### 8.4 Ca làm việc và routines

V0.1 có on-demand mặc định và routine hằng ngày/tuần. Có thể đặt khung giờ làm việc và giới hạn concurrency cho team.

Hết ca: không cấp step mới, checkpoint sau tác vụ đang chạy hoặc xin hủy theo policy. Tạo handoff gồm completed artifacts, blockers, next steps và budget state; không gọi LLM chỉ để viết worklog nếu có thể tổng hợp bằng code.

Scheduler dùng timezone của lịch, lưu thời điểm UTC. Máy ngủ/app tắt thì không chạy. Khi mở lại, mặc định bỏ qua các lần lỡ và hỏi có chạy một lần bù không; không chạy dồn hàng chục nhiệm vụ. Routines vẫn chịu ngân sách và approval như task thường.

## 9. Kết nối model và subscription

### 9.1 Native runtime là lõi

OpenAI API và Anthropic API chạy qua agent loop của Orglet: model request → tool proposal → policy/budget gate → tool result → tiếp tục → structured output.

Không dùng một harness bên ngoài để âm thầm thực hiện toàn bộ luồng native. Muốn đổi provider thì giữ worker ID, skill versions, task state và artifacts; output vẫn phải qua evaluator mới. Không suy ra chất lượng giữ nguyên chỉ vì schema giống nhau.

### 9.2 Codex adapter tùy chọn

Tài liệu OpenAI cung cấp app-server cho tích hợp vào sản phẩm, có authentication/events/approval; Codex hỗ trợ ChatGPT sign-in cho subscription và API-key sign-in cho usage-based access.[^codex][^auth]

Adapter là một execution backend riêng. Không lấy token subscription rồi gọi như OpenAI API tùy ý. Pin protocol/version đã test và công bố capability matrix cho adapter.

### 9.3 Claude subscription không là cổng API chung

Tài liệu Anthropic phân biệt native Claude Code do người dùng tự đăng nhập với third-party app gom/chuyển tiếp subscription credentials. V0.1 dùng Anthropic API; chưa đưa Claude Pro/Max vào native loop. Hướng chạy binary Claude Code nguyên bản có điều kiện riêng và cần một integration review riêng.[^claude]

Không scrape session cookies, không xây unofficial proxy và không bán lại quota tài khoản cá nhân.

## 10. Budget và phân bổ tài nguyên

### 10.1 API: số tiền theo scope

UI có `Giới hạn mỗi task`, `Giới hạn team/tháng` và `Giới hạn connection/tháng`. Giá trị mặc định chỉ là guardrail do người dùng chọn, không phải ước tính chi phí thị trường.

```text
Before dispatch:
spent_actual + reserved_inflight + estimated_request_upper_bound ≤ limit

After completion:
reconcile reserved amount → actual or provisional usage
```

Dùng integer money units, pricing-version và ledger entries bất biến. Giữ chỗ trong transaction trước khi gửi request để hai worker không cùng tiêu phần ngân sách còn lại.

Upper bound phải tính cả input/context, output cap, retry và tool cost đã biết. Nếu không có giá đủ tin cậy, đánh dấu estimate hoặc chặn chế độ hard-cap. Không tự đổi sang model đắt hơn, bật paid overage hoặc nạp credit.

Giới hạn của Orglet chỉ bao phủ request đi qua Orglet, không bảo đảm tổng hóa đơn của một API key còn dùng ở ứng dụng khác. Khi provider chậm trả usage, giữ reservation ở trạng thái chưa reconcile thay vì giả thành 0.

### 10.2 Subscription: hai màn số liệu khác nhau

**Quota của tài khoản:** provider-reported usage theo từng cửa sổ, reset time, timestamp và tình trạng stale/unknown. Codex app-server có trường usage percentage và window/reset metadata khi endpoint hỗ trợ.[^codex]

**Phân bổ trong Orglet:** tỷ trọng tài nguyên mà các team được ưu tiên sử dụng trong luồng do Orglet điều phối.

```text
Codex connection
Quota tài khoản: theo dữ liệu provider

Phân bổ công việc trong Orglet:
Eris Review      50%
Research        30%
Dự phòng        20%
```

Tooltip bắt buộc: `Đây là phân bổ nội bộ, không phải quota độc lập do nhà cung cấp cấp cho từng team.`

Không diễn giải 20% của gói giá $200 thành $40 API credit. Không suy ra 20% tháng tương đương 20% mọi cửa sổ ngắn hạn. User dùng Codex ngoài Orglet vẫn ảnh hưởng quota chung.

Scheduler dùng weighted fairness trên workload nội bộ, meter được thì dùng usage units, không meter được thì dùng proxy được ghi nhãn. Khi quota gần hết, ngừng dispatch mới và hiển thị reset/đợi; độ trễ số liệu và request đang chạy khiến không thể hứa chặn chính xác đến từng phần trăm.

V0.1 không vẽ bảng Claude subscription allocation khi integration đó chưa hỗ trợ.

## 11. Eris Review Team: template kiểm chứng

### 11.1 Thành viên

| Role | Công việc | Đầu ra |
|---|---|---|
| Challenge reviewer | Đọc mục tiêu, logic đánh giá, GPU relevance và các giới hạn | Findings có bằng chứng và checklist coverage |
| Data & scoring auditor | Schema, ID alignment, split, leakage checks, metric | Báo cáo checker + nhận định giới hạn |
| Run auditor | Đọc logs, repeatability, failure patterns và rank stability | Stability report hoặc insufficient evidence |
| Synthesizer | Ghép finding, giữ bất đồng, viết draft feedback | Review report + feedback ngắn |

Không thêm CEO, HR hoặc manager chỉ để mô phỏng tổ chức. Worker thứ tư là bước tổng hợp sau join, không phải cấp quản lý.

### 11.2 Luồng

```text
Import bundle + source manifest
              ↓
Trusted deterministic checks
              ↓
Challenge review / Data interpretation / Run audit
              ↓
Validate findings + resolve shared-state conflicts
              ↓
Synthesize recommendation + draft feedback
              ↓
An chấp nhận/chỉnh bản review trong Orglet
```

V0.1 đọc code challenge như text, không chạy training hoặc script lạ trên host. Những kiểm tra đòi hỏi execution mà chưa có sandbox sẽ trở thành yêu cầu bổ sung logs hoặc bước thủ công.

### 11.3 Chính sách Eris cần đưa vào template

- Kiểm tra đúng schema giữa prepared submission/sample submission và answers; kiểm tra cả ID/alignment khi contract yêu cầu.
- GPU relevance, mục tiêu thực tế, dataset quality và solvability cần bằng chứng; ngưỡng dataset size/split theo từng loại task, không dùng một con số chung làm luật máy móc.
- Phân biệt khác biệt năng lực giữa solutions với nhiễu khi rerun cùng solution. Không tạo variance giả để challenge trông khó hơn.
- Mẫu kết quả `0.45/0.45/0.00` cần điều tra failure/rerun, không tự động approve hoặc kết luận cheating.
- Public #15 → private #1 là tăng 14 bậc, không phải tăng 145 và không tự chứng minh challenge hỏng. Phải kiểm tra distribution, metric, sample size và stability.
- Creator-side fixes tập trung vào prepared data và scoring trong quyền kiểm soát. Không biến yêu cầu đổi platform runner thành blocker mà creator không thể xử lý.
- Vấn đề chưa đủ chứng cứ được ghi `insufficient_evidence`; vấn đề thực sự chưa giải quyết thì khuyến nghị revision/rerun, không approve dễ dãi.
- Feedback ngắn, tự nhiên, dựa trên bằng chứng. Không tự gửi message hoặc submit bất cứ thay đổi nào.

Các policy trên được trích từ yêu cầu An đã nêu trong trao đổi; đây không phải tuyên bố rằng chúng là toàn bộ quy định công khai của Eris. Khi có hướng dẫn challenge cụ thể, intake phải nạp và phát hiện xung đột.

### 11.4 Định dạng nguồn vào

V0.1 nhận thư mục được user chọn, Markdown/text/code đọc-only, CSV/Parquet/JSONL được hỗ trợ bởi checker, và run-log export. Có giới hạn file size/time/memory, cancellation và trạng thái unsupported rõ.

Mọi nhận xét dataset phải nêu coverage: toàn bộ hay sampled, cột nào, checks nào. `Không phát hiện bằng các checks đã chạy` khác `chắc chắn không có leakage`.

## 12. Security và quyền của người dùng

**Default read-only.** Chỉ nhận quyền đọc các path cụ thể từ OS dialog và quyền ghi trong artifact directory của task. Export ra ngoài cần người dùng chọn đích.

Policy runtime cần ít nhất: `allow`, `ask`, `deny`. Scope/args thay đổi sau approval thì phải duyệt lại; không tái dùng approval của lệnh khác. Policy gate thực thi ở core, không chỉ nằm trong prompt.

Electron renderer dùng context isolation, sandbox, tắt Node integration, CSP nghiêm ngặt và IPC allowlist. Không render HTML/JS do model trả về như code tin cậy.[^electron]

API keys được bảo vệ bằng OS-backed credential storage; trên Windows Electron safeStorage dùng DPAPI nhưng không cách ly khỏi mọi tiến trình chạy cùng user. Đây không phải bảo vệ chống malware trên máy đã bị xâm nhập.[^secrets]

Additional requirements:

- Không log/export keys, cookies, access tokens hoặc toàn bộ environment.
- Không để worker nhận secret thô. Gateway thêm credentials sau bước authorization.
- Path validation xử lý traversal, symlink/junction/reparse point; không tin đường dẫn do LLM tự dựng.
- Không có unrestricted shell, browser automation hoặc arbitrary script execution trong native v0.1.
- Chỉ gửi dữ liệu/bằng chứng đã được phép sang provider. Local-first không có nghĩa inference cũng local.
- Private challenge answers và dữ liệu khách hàng không tự động upload. Cho biết file/snippet nào sẽ rời máy, scope consent theo connection/team.
- Built-in profilers không được cài extension, truy cập mạng hoặc ghi file theo lệnh tùy ý từ dữ liệu đầu vào.
- Native parser/helper cần được đánh giá isolation riêng; utility process không được quảng cáo là sandbox an toàn cho input độc hại.
- Audit log local hữu ích để truy vết, nhưng không gọi là bất biến chống owner sửa hoặc đạt compliance enterprise.

Adapter chưa ánh xạ được filesystem, network, tool approvals hoặc usage caps phải bị giới hạn khả năng. Không dùng nhãn `read-only` chỉ vì đã viết câu đó vào prompt.

## 13. Milestones triển khai

Các mốc theo dependency và tiêu chí nghiệm thu, không phải cam kết thời gian.

### M0: Foundation và packaging spike

Tạo repository, React/Electron shell, theme tokens, typed IPC, SQLite migrations và test harness. Kiểm tra installer Windows, database engine version và native data-checker dependencies ngay ở đây.

**Xong khi:** mở/cài app trên Windows test environment, tạo task giả được lưu lại sau restart, không cần WSL, UI renderer không có secret/fs access.

### M1: Một worker hoàn thành một công việc thật

Native OpenAI connection, context compiler tối thiểu, trusted file reader, tool-call validation, streaming UI, artifact writer. Làm budget reservation và permission gate cho luồng đầu tiên, không để cuối dự án.

**Xong khi:** chọn file → worker tạo báo cáo thật có references → xem artifact → restart không mất lịch sử → cancel không tạo thêm request mới.

### M2: Team, shared state và Eris

Worker CRUD, team membership, instruction/skill revisions; tuần tự và parallel-join; structured findings; Eris template; partial failure, retry và approval UI.

**Xong khi:** các role không overwrite finding của nhau; thiếu logs không thành PASS; một role lỗi vẫn giữ kết quả của role khác; một kết luận chung có đường dẫn ngược về bằng chứng.

### M3: Portability và resources

Thêm Anthropic native API, provider capability tests, Codex app-server adapter, quota display, weighted allocation, scoped budget reporting.

**Xong khi:** cùng worker/template chạy qua hai API provider không sửa canonical skills; Codex là tùy chọn, không là dependency của native path; quota unknown hiển thị unknown; hai request đồng thời không vượt reservation bằng race condition.

Codex adapter chỉ bật các quyền đã vượt conformance tests. Không đạt quyền/cap/billing constraints thì giữ experimental/disabled, không giả vờ đầy đủ chức năng để đạt milestone.

### M4: Recovery, routines và UX hardening

Checkpoint/resume, stale-lease recovery, simple routines, missed-run policy, import/export template, backup/restore; empty/error states, keyboard, resize, theme.

**Xong khi:** kill/restart có thể tiếp tục bước cần làm mà không tự replay action rủi ro; máy sleep không tạo burst catch-up; export/import không mang theo credentials hoặc knowledge ngoài scope.

### M5: Benchmark và release candidate

Chạy corpus Eris đã được phép dùng, baseline một agent/manual và team; test generic Research/Review template; Windows installer, dependency checks, migration rollback, source/privacy review.

**Xong khi:** có báo cáo kết quả thật, có giới hạn đã biết, những đường dẫn chưa hỗ trợ bị ẩn/disabled đúng; không ship screen đẹp nhưng action chính là mock.

## 14. Kiểm chứng hiệu quả

### 14.1 Dataset và baseline

Khởi đầu bằng 20 case được phép sử dụng: 12 development, 8 holdout đóng băng. Đây là smoke evaluation nhỏ, không đủ để khẳng định độ tin cậy rộng.

Bao gồm: case sạch; lỗi schema; ID misalignment; leakage có chủ đích; run failure; logs thiếu; rank reversal không nhất thiết lỗi; tài liệu chứa instruction độc hại; file không hỗ trợ; thiếu quyền.

So sánh:

**A:** quy trình thủ công hiện tại với Codex/Claude và cùng hướng dẫn/tài liệu.

**B:** một worker trong Orglet với cùng model, tools và mức ngân sách.

**C:** Eris Team trong Orglet với cùng model khả dụng và cùng trần ngân sách tổng.

B so với C kiểm tra multi-agent có đáng dùng không. Swap provider là một test riêng, không trộn với phép đo cải thiện do orchestration. Ghi model/config/date vì hành vi có thể thay đổi.

### 14.2 Metrics

| Metric | Định nghĩa |
|---|---|
| Human active time | Thời gian An thực sự thao tác/đọc/chỉnh, tách khỏi thời gian chờ |
| Critical false approval | Case có blocker rõ nhưng app khuyến nghị approve |
| Finding precision/recall | So sánh finding có bằng chứng với nhãn đã kiểm tra |
| Evidence coverage | Tỷ lệ finding có source đúng và đủ hỗ trợ |
| Accepted-report rate | Bản review dùng được với mức sửa đã quy định |
| Cost/accepted report | Actual/provisional API cost; subscription allocation báo riêng |
| Completion/recovery | Task hoàn tất hoặc resume đúng sau các lỗi được tiêm |

Không lấy số token, số bot hoặc số task làm đại diện trực tiếp cho giá trị. Subscription không được ghi là zero economic cost; tách phí cố định, usage nội bộ và API charges để người dùng hiểu.

### 14.3 Gate đề xuất, không phải kết quả đã đạt

- Tất cả deterministic fixtures quan trọng pass, không có permission/budget bypass trong bộ test.
- Không có false approval trên các critical fixtures đã gán nhãn; báo cả tử số/mẫu số, không quảng cáo `0% lỗi` tổng quát.
- Mọi finding được chấp nhận có evidence reference resolve được; nhận định vượt coverage bị phát hiện.
- Mục tiêu giảm ít nhất 30% median human active time so với baseline mà không giảm quality gate. Nếu không đạt, giữ workflow đơn giản hoặc giảm số worker.
- Resume không duplicate artifact commit và không tự replay action chưa xác định kết quả.
- Tạo được một team không liên quan Eris bằng UI/template mà không sửa core.

Chỉ phát biểu đã nhanh hơn/rẻ hơn sau khi có measurements. Case holdout không dùng để sửa prompt rồi tiếp tục gọi là holdout cũ.

## 15. Demo bắt buộc trước khi mở rộng

Một demo end-to-end nên cho thấy:

1. Tạo `Eris Review` từ template, chỉnh một instruction và thấy version mới.
2. Chọn challenge bundle, chạy review thật, xem progress gọn.
3. Mở một finding và đi đến đúng nguồn/checker output.
4. Thiếu run logs thì hệ thống hỏi bổ sung, không tự pass.
5. Pause/restart/resume, kết quả đã có không mất.
6. Đổi provider cho worker, chạy lại với cùng skills/state snapshot và đánh giá output mới.
7. Chạm budget hoặc quota, công việc chờ thay vì âm thầm tiêu nguồn khác.
8. Chấp nhận bản review và xuất Markdown, không thay đổi nền tảng Eris.

Sau đó tạo một Research/Review Team nhỏ để chứng minh Orglet là sản phẩm tổng quát.

## 16. Mở rộng sau MVP

**V0.2, Company Lite:** nhóm nhiều team, mục tiêu chung, shared policies/budget, handoff liên-team kiểu pipeline và một inbox approvals. Không cần CEO agent bắt buộc.

**V0.3:** thêm adapter có conformance tests, remote execution có sandbox thực, approvals cho external writes, optional cloud sync/runner và team templates chia sẻ có kiểm soát.

**Chưa ưu tiên:** payroll kinh tế nội bộ, tuyển dụng tự động, bank accounts, tự đổi cơ cấu tổ chức, marketplace đại trà, giá trị doanh thu do agent tự quy công.

Monetization chỉ kiểm chứng sau dogfood: trước hết đo willingness-to-pay cho việc giảm công điều phối/review. Khi beta, tách phí Orglet khỏi phí model; không dựa mô hình kinh doanh vào resale subscription quota.

## 17. Definition of Done toàn MVP

MVP đạt khi một người dùng mới có thể kết nối provider được hỗ trợ, tạo worker hoặc team, giao việc với file, nhận artifact có nguồn, kiểm soát chi phí/quyền, sửa instructions và dùng lại vào task sau mà không mở terminal để sửa config.

Native engine phải hoạt động khi không cài Codex/Claude Code/OpenClaw. Company không bắt buộc. Eris không hard-code vào engine. Dữ liệu và secret không xuất ngoài scope. Những giới hạn còn lại được phản ánh bằng trạng thái thật trong UI.

**Ưu tiên cuối cùng:** một task thật chạy tốt từ đầu đến cuối có giá trị hơn mười màn dashboard chưa nối với runtime.

---

## Nguồn kỹ thuật đã đối chiếu

Các nguồn dưới đây hỗ trợ các chi tiết tích hợp và công nghệ. Phần lựa chọn kiến trúc, giao diện, mốc triển khai và benchmark là đề xuất của kế hoạch. Kiểm tra lại compatibility và điều khoản trước khi release vì tài liệu có thể thay đổi.

[^codex]: OpenAI, Codex App Server: https://developers.openai.com/codex/app-server/
[^auth]: OpenAI, Codex Authentication: https://developers.openai.com/codex/auth/
[^claude]: Anthropic, Claude Code Legal and Compliance, đặc biệt Authentication and credential use và Can customers offer Claude Code in their products?: https://code.claude.com/docs/en/legal-and-compliance
[^skills]: Agent Skills specification: https://agentskills.io/specification
[^electron]: Electron security checklist: https://www.electronjs.org/docs/latest/tutorial/security
[^secrets]: Electron safeStorage: https://www.electronjs.org/docs/latest/api/safe-storage
[^utility]: Electron utilityProcess: https://www.electronjs.org/docs/latest/api/utility-process
[^wal]: SQLite Write-Ahead Logging, gồm mục WAL-reset bug: https://sqlite.org/wal.html
[^fts]: SQLite FTS5: https://sqlite.org/fts5.html
[^shadcn]: shadcn/ui introduction: https://ui.shadcn.com/docs
[^duckdb]: DuckDB Node.js client: https://duckdb.org/docs/current/clients/node_neo/overview
