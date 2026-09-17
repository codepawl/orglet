# Prompt khởi động triển khai Orglet

Dùng cùng `orglet_mvp_plan_vi.md`. Đây là prompt để bắt đầu phát triển, không phải code sản phẩm đã hoàn thành.

---

Bạn là coding agent triển khai **Orglet**, một Windows desktop workspace cho AI Worker và Team. Đọc toàn bộ `orglet_mvp_plan_vi.md`, lấy nó làm product/architecture contract. Nếu repository đã có code, kiểm tra cấu trúc và tests trước khi thay đổi; không ghi đè hàng loạt.

## Mục tiêu

Xây một vertical slice thật từ UI → policy/budget gate → native model API → artifact → persistent history. Sau đó mở rộng từng milestone M0–M5. Không bắt đầu bằng org chart, company simulator hoặc dashboard mock.

## Những ràng buộc không được tự đổi

1. Orglet sở hữu instructions, skills, worker identity, task state và orchestration. Native path phải chạy khi không cài Codex, Claude Code hoặc OpenClaw.
2. Worker và Team tồn tại độc lập. Company không bắt buộc trong onboarding hoặc schema quan hệ của Worker/Task.
3. Chọn Electron + React + TypeScript + Vite + Tailwind + shadcn/ui; local core trong utility process; SQLite local. Không tự thêm backend cloud, Redis hoặc Kubernetes.
4. UI theo hướng ChatGPT: sidebar gọn, nội dung một cột, composer phía dưới, panel chi tiết mở khi cần. Không gradient/neon, office 3D, org chart mặc định, logo OpenAI hoặc font độc quyền.
5. Secrets không vào renderer, logs hoặc template export. Typed IPC allowlist; contextIsolation/sandbox bật; Node integration tắt trong renderer.
6. Native v0.1 chỉ dùng trusted readers/checkers; không chạy code challenge, imported scripts hoặc unrestricted shell. Prompt không phải sandbox.
7. Budget reservation và permission check có từ request thật đầu tiên. Giao dịch ledger dùng integer money units và atomic reservation.
8. API budget không bằng provider account spending toàn cục. Subscription allocation là quota/fairness nội bộ, không tự đổi phần trăm thành API credits.
9. Chỉ tích hợp subscription qua cơ chế được provider hỗ trợ. Native Anthropic dùng API. Không thu thập cookies/OAuth tokens để xây unofficial proxy.
10. Codex app-server là adapter tùy chọn; chạy dưới capability matrix, không hứa native và harness có cùng quyền/khả năng.
11. Eris chỉ là template/skill/schema. Không hard-code tên Eris vào orchestration engine.
12. Không submit, approve, gửi message hoặc sửa dữ liệu bên ngoài thay người dùng trong MVP.
13. Missing evidence, unknown usage, partial failure phải hiển thị đúng. Không đổi thành success để demo đẹp.
14. Model/SDK/protocol versions và pricing phải được kiểm tra bằng tài liệu chính thức rồi pin trong lockfile/capability catalog. Không suy diễn từ tên model nhớ sẵn.

## Bước bắt đầu

Trước khi code, tạo `docs/implementation_status.md` ghi:

- Hiện trạng repo, dependencies và các test có sẵn.
- Milestone hiện tại và tiêu chí nghiệm thu.
- Những quyết định đã chốt trong plan.
- Blocker kỹ thuật thật sự cần xác minh, không đặt lại những câu hỏi plan đã trả lời.

Sau đó thực hiện M0 và vertical slice của M1:

**M0**

- Bootstrap desktop application, scripts dev/build/test, lockfile và CI phù hợp.
- Tạo theme light/dark theo token trong plan và AppShell/Sidebar/Composer/TaskThread/DetailDrawer.
- Tạo typed IPC, local database migrations, repositories và mock provider dùng riêng cho tests/demo.
- Kiểm tra SQLite runtime engine có bản vá WAL cần thiết; kiểm tra Windows native packaging.
- Tạo smoke test: mở app, tạo task, restart và task còn nguyên.

**M1**

- Thêm OpenAI API connection; user chủ động nhập key, key lưu bằng OS-backed storage.
- Tạo Worker với instructions và một skill đã version.
- Cho user chọn file có scope quyền rõ, intake manifest và source references.
- Implement native model/tool loop với schema validation, tool gate, cost reservation, timeout/cancel.
- Tạo artifact Markdown/report có evidence references, lưu run manifest và usage ledger.
- Hiển thị tiến độ ở mức hành động, không dump nội bộ multi-agent hoặc yêu cầu hidden reasoning.
- Resume lịch sử sau restart; run gián đoạn không tự đổi thành completed.

Chỉ sau vertical slice này mới mở M2 (Team/Eris). Không implement cả năm milestone cùng lúc mà bỏ qua nghiệm thu.

## Quy tắc code

Dùng module nhỏ theo domain. Model adapters không được import UI. Renderer không import filesystem/database/provider secrets. Business state không nằm trong component React hoặc localStorage.

Các bước workflow ghi kết quả qua validated artifacts/findings, không overwrite một file chung. Dùng optimistic version check hoặc transaction ở commit boundary.

Skill/instruction update tạo revision mới; run snapshot giữ version cũ. Permission revocation có hiệu lực ở mỗi tool gate ngay cả khi run đang giữ instruction snapshot cũ.

Mỗi external call có correlation ID, timeout, cancellation và usage state. Không retry mù action không idempotent hoặc request chưa rõ đã tiêu phí/chạy thành công chưa.

Không gắn success với một chuỗi trả lời của LLM. Completion cần output schema hợp lệ và các required gates được thỏa mãn.

## Test tối thiểu

- Policy deny chặn tool dù model yêu cầu bằng lời thuyết phục.
- Hai request đồng thời không oversubscribe cùng budget reservation.
- Unknown pricing/quota không biến thành free/unlimited.
- File path traversal và dữ liệu nhúng instruction không cấp thêm quyền.
- Secret không có trong renderer state, logs và export.
- Skill update không thay nội dung snapshot run cũ.
- Worker/team state không rò giữa các scope.
- Cancel ngừng dispatch mới, giữ artifact đã commit.
- Crash/restart giữ lịch sử và không tạo duplicate artifact.
- UI xử lý IME, keyboard navigation, partial/error và không tự cuộn khi user đọc lịch sử.

## Báo cáo sau mỗi milestone

Ghi rõ đã sửa file nào, flow thật nào hoạt động, commands/tests đã chạy với kết quả thật, phần nào còn mock, known limitations và milestone tiếp theo. Không tuyên bố đã test installer, API request hoặc benchmark nếu chưa thực hiện được.

Không tự mua dịch vụ, tạo tài khoản, push repository, publish package hoặc deploy cloud. Mọi hành động bên ngoài cần được người dùng yêu cầu rõ.
