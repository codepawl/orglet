# Plan: CodePawl router (tên đề xuất: Pawlway)

Ngày 2026-10-07. Bản để An xem trước khi code. Router là sản phẩm trả phí đầu tiên trong `account-sync-design.md`:
"the model router and a model subscription", sau đó mới tới các phần hạ tầng tốn tiền. Account đã có `plan` và
`entitlements` từ phase 1 để bật router không cần migration.

## Mục tiêu

Một gói đăng ký, mọi model, ngay trong Orglet: người dùng không cần tự lấy API key ở OpenAI, Anthropic, Google; đăng
nhập CodePawl là chat được. Có chế độ **Tự chọn** để router gửi việc nhẹ cho model rẻ và việc khó cho model mạnh, và
người dùng vẫn ghim được một model. Hạn mức hiện trong thanh dùng của ô nhập như các gói Claude và ChatGPT đang hiện.

## Tên

| Tên | Ý | Ghi chú |
|---|---|---|
| **Pawlway** (đề xuất) | CodePawl + gateway/pathway: con đường dẫn mỗi tin tới đúng model | Từ tự ghép nên dễ có tên miền và ít trùng; đọc liền với CodePawl |
| Leash | Sợi dây giữ cả bầy model trong tay | Ngắn, hợp chủ đề "pawl"; từ tiếng Anh thường, khó giữ thương hiệu |
| Pack | Một gói, cả bầy model | Hợp làm **tên gói** ("Orglet Pack") hơn tên dịch vụ |
| Scout | Đi tìm model hợp với việc | Đã có nhiều sản phẩm tên Scout |
| Burrow | Đường hầm tới các model | Nghĩa hơi tối |

Đề xuất: dịch vụ tên **Pawlway** (`pawlway.codepawl.com` hoặc `router.codepawl.com`), gói trả phí tên **Orglet Pack**.
Chưa kiểm nhãn hiệu: cần tra USPTO/WIPO và tên miền trước khi công bố (guessed: Pawlway hiếm gặp).

## Điều khoản nhà cung cấp quyết định hình dạng

- Anthropic Commercial Terms: không được bán lại Services nếu Anthropic chưa duyệt; được dùng để chạy sản phẩm của mình
  cho người dùng cuối. (https://www.anthropic.com/legal/commercial-terms, đọc qua kết quả tìm kiếm 2026-10-07)
- OpenAI Services Agreement: không được bán lại hay cho thuê quyền truy cập; được tích hợp vào ứng dụng của mình cho
  người dùng cuối. (https://openai.com/policies/services-agreement/, như trên)

Vì vậy giai đoạn đầu router **chỉ phục vụ Orglet** (một tính năng trả phí của ứng dụng), không phải API công khai cho
lập trình viên khác. Một endpoint công khai kiểu OpenRouter chỉ làm sau khi có thỏa thuận bán lại với từng nhà cung cấp.
Cả hai trang trên cần đọc lại bản gốc đầy đủ (hoặc hỏi luật sư) trước khi thu tiền: đây là chỗ không được đoán.

## Kiến trúc

```
Orglet (main giữ token) ──► router.codepawl.com (Cloudflare Worker)
                              ├─ xác thực: access token của account, resource "router"
                              ├─ hạn mức: Durable Object mỗi account (đếm token, chặn khi hết)
                              ├─ Tự chọn: Tacet / OpenAI Decisions (gpt-6-luna, $0.10/1M) phân loại việc → chọn model
                              ├─ gọi lên: key riêng của CodePawl (OpenAI, Anthropic) hoặc Cloudflare AI Gateway
                              └─ đo: usage thật từ nhà cung cấp → sổ cái → entitlements
```

- **Endpoint**: tương thích OpenAI (`/v1/chat/completions`, `/v1/models`) để adapter OpenAI sẵn có của Orglet dùng lại;
  thêm đường đi thẳng Anthropic Messages để giữ prompt caching và thinking của Claude.
- **Gọi lên**: hai cách, chốt bằng số tiền thật sau một tháng thử:
  - Key trực tiếp của CodePawl với OpenAI và Anthropic: rẻ nhất, giữ đủ tính năng (cache, batch).
  - Cloudflare AI Gateway Unified Billing: một hóa đơn, hơn 350 model, phí credit 5% cộng giá gốc
    (https://developers.cloudflare.com/changelog/post/2026-08-07-workers-ai-unified-billing/). Hợp cho các model ít
    dùng.
- **Không lưu nội dung**: Worker không log prompt hay câu trả lời; AI Gateway tắt log nội dung; chỉ giữ số token, model,
  thời gian, mã lỗi. Bật Zero Data Retention ở nhà cung cấp khi đủ điều kiện.
- **Hạn mức**: tính theo "điểm" quy từ giá thật của model (giống token cost), có hạn 5 giờ và hạn tuần như các gói
  Claude, để một ngày dùng nặng không ăn hết tháng. Hết hạn mức thì báo rõ, gợi ý model rẻ hơn hoặc dùng key riêng.

## Trong Orglet

- **Kết nối mới "CodePawl"** trong Cài đặt → Kết nối API: không có ô key, chỉ cần đăng nhập. Danh sách model lấy từ
  `/v1/models` của router, có mục **Tự chọn** đứng đầu.
- Main giữ token router như token sync (đã có `getAccessToken(resource)`), renderer không bao giờ thấy.
- Thanh dùng của ô nhập (đã có cho Claude Code, Codex) hiện hạn mức router: còn bao nhiêu trong 5 giờ và trong tuần.
- Tacet có thể chạy qua router luôn, nên người không có key OpenAI vẫn có Tacet.
- Chat "Chỉ trên máy này" vẫn dùng được router (router là một kết nối API như mọi kết nối khác), và Cài đặt nói rõ nội
  dung đi qua CodePawl tới nhà cung cấp.

## Gói và thu tiền

- `plan` trên account: `free` hôm nay; thêm `pack` (tên gói). `entitlements` thêm `routerPointsPer5h`,
  `routerPointsPerWeek`, `routerModels`.
- Thanh toán: Polar (merchant of record, lo thuế VAT nước ngoài cho hộ kinh doanh ở Việt Nam), webhook đã thiết kế ở
  `accounts.codepawl.com` cập nhật `plan` và tính lại entitlements. Cần kiểm lại Polar còn nhận người bán này không.
- Giá: chốt sau khi đo chi phí thật của 2 tuần dùng thử nội bộ. Nguyên tắc: gói có biên lợi nhuận dương ở người dùng
  nặng nhất trong hạn mức, nhờ hạn 5 giờ/tuần chứ không nhờ tăng giá.
- Free: không có router, hoặc một lượng thử rất nhỏ mỗi tuần để người mới chat được ngay lần đầu.

## Các bước

1. **Kiểm điều khoản và chi phí** (S, An + tao): đọc bản gốc điều khoản OpenAI, Anthropic, Google về dùng API trong sản
   phẩm trả phí; hỏi Polar; ước giá vốn cho 3 kiểu người dùng (nhẹ, vừa, nặng) từ số token thật trong benchmark.
2. **Router tối thiểu** (M): Worker, xác thực token account, endpoint OpenAI-compatible, 3–4 model, đo token, Durable
   Object hạn mức, không log nội dung. Chạy dưới `router.codepawl.com` cho tài khoản nội bộ.
3. **Kết nối CodePawl trong Orglet** (M): provider mới, danh sách model, thanh dùng, docs, test với router giả.
4. **Tự chọn** (M): phân loại bằng Decisions API, bảng luật chọn model, benchmark agent-bench so với ghim một model.
5. **Thu tiền** (M): Polar, webhook, entitlements, trang gói trong Cài đặt → Tài khoản.
6. **Thử kín rồi mở** (S): vài người dùng thật, theo dõi chi phí từng ngày, rồi bật cho mọi người.
7. **Sau này**: API công khai cho lập trình viên khi có thỏa thuận bán lại; model chạy trên Workers AI cho gói rẻ.

## Rủi ro

- Điều khoản nhà cung cấp: bán lại không được phép nếu chưa duyệt; giữ router trong Orglet và đọc lại bản gốc.
- Biên lợi nhuận mỏng: hạn 5 giờ/tuần, đo chi phí thật trước khi chốt giá.
- Lạm dụng (bot, thẻ ăn cắp): giới hạn theo account đã có, Polar lo gian lận thẻ, chặn đăng ký hàng loạt.
- Router là điểm gãy duy nhất: Orglet vẫn chạy với key riêng và harness nếu router chết; app không bao giờ tự đổi sang
  kết nối khác mà không báo (luật sẵn có).
- Quyền riêng tư: nội dung đi qua CodePawl; không lưu, nói rõ trong app và docs.

## An quyết

- Tên: Pawlway hay tên khác.
- Có gói Free dùng thử router không, và bao nhiêu.
- Gọi lên bằng key trực tiếp, AI Gateway, hay cả hai.
- Có liên hệ Anthropic/OpenAI xin duyệt bán lại để sau này mở API công khai không.
