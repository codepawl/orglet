# Plan: một chat chạy mãi, điều phối Tí, và kết nối

Ngày 2026-10-07. Bản để An xem lại trước khi code; chưa triển khai gì. Mỗi giai đoạn là một PR riêng (thay đổi lớn,
đúng ngoại lệ "một PR mỗi buổi"). Nhãn: **đo** = đã chạy và thấy, **code** = đọc trong code, **docs** = đọc ở nguồn
gốc, **suy** = suy luận.

## Hướng sản phẩm làm nền

Mỗi Tí (và mỗi kênh) có đúng một chat liên tục như nhắn tin trực tiếp, không mở thêm phiên nào. Vậy mọi thứ dưới đây
phải giữ được: chat dài mãi mà không quên sai, không tốn thêm theo độ dài, không đẻ thêm chat, và mọi việc ngầm (lịch,
hook, nhờ Tí khác) đổ về đúng chat đó.

## Hiện trạng đã kiểm

| Chỗ | Hiện tại | Nhãn |
|---|---|---|
| Lịch sử chat | Giữ nguyên văn 10 lượt gần nhất, tối đa 24.000 ký tự; lượt cũ hơn chỉ giữ **dòng đầu**, tổng 8 KB; lấy lại tối đa 4 đoạn cũ theo từ khóa (`core/context/thread.ts:9-15`) | code |
| Thứ tự tóm tắt | Duyệt lượt bị bỏ từ **cũ nhất**, đầy 8 KB thì bỏ phần còn lại, nên chat dài giữ chuyện tuần đầu và mất các lượt vừa rời cửa sổ (`thread.ts:139-160`, `:198`) | code |
| Từ chối 200 KB | Chỉ xảy ra khi tin hiện tại + nguồn quá lớn; lịch sử luôn bị cắt về khoảng 40-60 KB | code |
| Thử lại khi lỗi mạng | SDK Anthropic và OpenAI đặt `maxRetries: 0` (`adapters/anthropic.ts:154`, `openai.ts:107`); không có lớp thử lại nào khác; 429 chỉ ra thông báo | code |
| Tắt app giữa chừng | Lần chạy thành "bị gián đoạn", không tự gửi lại; **Resume** chạy tiếp từ checkpoint, trừ khi đang chờ model (chỉ còn Retry) (`storage/database.ts:539`, `runner.ts:639`) | code |
| Nhắn khi Tí đang làm | Dừng lượt cũ rồi chạy lượt mới; tin thứ hai lúc đang dừng bị từ chối (`service.ts:1719`) | code |
| Lịch chạy | Mỗi lần chạy là một chat riêng (`docs/routines.md:112`) | docs |
| Claude Code mỗi bước | Tiến trình mới, gửi lại toàn bộ; hai lần gửi y hệt 70 KB: ghi cache 26.679 / 25.769 token, đọc 531 / 1.440, khoảng $0.10 mỗi lần | đo |
| Claude Code `--resume` | Cũng không đọc cache: lần tiếp tục ghi lại 25.781 token, tổng $0.207 | đo |
| OpenAI cached tokens | SDK có `usage.prompt_tokens_details.cached_tokens` (`openai/resources/completions.d.ts:158`), Orglet không đọc | code |
| Anthropic cache | Có `cache_control` 5 phút trên system và khối cuối (`anthropic.ts:112,171`) | code |
| Crew | Mọi tin đều: lead lập kế hoạch → thành viên → lead gộp; kế hoạch bắt buộc ≥ 1 việc (`contracts.ts:197`); song song tối đa 2 (`team.ts:128`); một cấp | code |
| Chat riêng nhờ Tí khác | Không có; prompt nói Tí không thấy Tí khác (`context/compiler.ts:121`) | code |
| Thông báo | Bấm mở đúng chat, không cuộn tới tin (`main/index.ts:217`); đường cuộn tới tin đã có cho tìm kiếm (`App.tsx:777`) | code |
| Hook | Chỉ có lịch "khi có file mới" và `orglet run`, khi app đang mở | docs |
| MCP | Tự thêm server, token Bearer; không OAuth, không danh mục | docs |

Nguồn ngoài đã đọc (2026-10-07): Anthropic prompt caching, compaction, context editing; OpenAI prompt caching,
compaction; Anthropic "multi-agent research system" và "Building effective agents"; Cognition "Don't build
multi-agents"; Claude Code subagents; MCP authorization 2026-07-28; MCP Registry; tài liệu MCP của GitHub, Linear,
Notion, Atlassian, Slack, Google; Windows `UserNotificationListener`. Danh sách link ở cuối.

## Giai đoạn 0: sửa nhanh, rủi ro thấp (một PR)

1. **Thông báo cuộn tới đúng tin.** Thông báo mang thêm `messageId` (thông báo hệ điều hành, toast, dòng trong chuông);
   bấm thì đi qua `openMessage` có sẵn. Chứng minh: test dựng thông báo có `messageId`, smoke bấm thông báo và thấy tin
   được tô sáng.
2. **Phần lượt cũ giữ lượt gần, không giữ lượt cũ nhất.** Đảo chiều `extractive`: lấy từ lượt mới nhất của phần bị
   bỏ trở về trước cho đến khi đầy, rồi xếp lại theo thời gian. Có test chat 40 lượt. Giai đoạn 1 thay hẳn phần này,
   nhưng sửa trước vì hiện tại đang quên sai.
3. **Tin nhắn thứ hai khi Tí đang dừng thì xếp hàng.** Thay vì báo lỗi, gộp vào tin đang chờ (`currentInput`) để lượt
   mới nhận cả hai. Test: hai tin liên tiếp trong lúc dừng đều tới được lượt mới.
4. **Tự thử lại những lỗi chắc chắn chưa xử lý.** Ở runner, quanh đúng lời gọi model: 429 (theo `retry-after`), 529 và
   "overloaded", 503 trước khi có byte nào, lỗi DNS hoặc từ chối kết nối. Tối đa 3 lần, giãn 2 s, 8 s, 30 s có nhiễu,
   island hiện "Đang thử lại (2/3)…". Lỗi mơ hồ (đứt giữa luồng trả lời) giữ như cũ, vì có thể đã bị tính tiền và
   quy tắc hiện tại cố ý không gửi lại. Harness CLI: đọc stderr, chỉ thử lại một lần khi rõ là lỗi mạng trước khi chạy.
   Test bằng adapter giả trả 429 rồi thành công.

## Giai đoạn 1: chat chạy mãi (PR riêng, lớn nhất)

Model không nhớ gì giữa các lần gọi: mỗi tin, Orglet gửi lại phần lịch sử chọn ra. Câu hỏi duy nhất là chọn phần
nào khi lịch sử dài hơn mức gửi được. An chốt (2026-10-07): **không dùng model để tóm tắt**; tùy chỉnh của Tí đã nằm ở
hướng dẫn, memory và skill. Compaction của nhà cung cấp cũng không dùng (khóa vào một nhà cung cấp, không đọc được,
không chạy với harness CLI, mất khi đổi model).

1. **Gửi nguyên văn theo cửa sổ của model.** Thay mức cứng 10 lượt / 24.000 ký tự bằng một ngân sách lịch sử tính từ
   cửa sổ context của model (đã có trong `capabilities` và `harness/context-use.ts`), ví dụ một phần tư cửa sổ, có trần
   để giữ chi phí mỗi tin. Model cửa sổ lớn nhớ nguyên văn được rất xa; model nhỏ vẫn chạy.
2. **Lượt cũ hơn lấy lại theo độ liên quan**, không theo thứ tự: mở rộng phần lấy lại theo từ khóa đang có
   (`retrieve`), ưu tiên lượt chứa quyết định, con số, tên tệp, link; bỏ phần "dòng đầu của lượt cũ nhất".
3. **Chuyện cần nhớ lâu nằm ở memory** (đường đề xuất và duyệt có sẵn), không nằm ở lịch sử.
4. **Cache prompt.**
   - Thứ tự prompt cố định: công cụ → system → lịch sử nguyên văn → tin mới; đầu prompt chỉ đổi khi lượt cũ nhất rời
     ngân sách.
   - Anthropic: thử TTL 1 giờ (ghi 2x, đọc 0.1x) so với 5 phút (ghi 1.25x) trên một kịch bản 20 lượt có khoảng nghỉ
     2, 10, 30 phút; chọn theo số đo, không đoán.
   - OpenAI: đọc `prompt_tokens_details.cached_tokens`, tính giá đọc cache, gửi `prompt_cache_key` theo chat.
   - Đo bằng `cache_read_input_tokens` trước và sau, ghi vào docs.
5. **Harness CLI.** Đã đo: dùng lại session không đọc được cache, nên không làm `--resume` (còn vướng quyền riêng tư,
   `technical-guide.md:164`). Thay vào đó giảm byte mỗi bước trong một lượt nhiều bước: kết quả công cụ cũ hơn N bước
   cắt còn đầu và một dòng "đã đọc, xem ghi chú" (giống context editing của Anthropic); ghi chú bước (`notes`) đã có
   giữ phần cần thiết. Đo bằng `harness-step-cost.test.ts`.
6. **Docs.** Viết lại `technical-guide.md` phần context (đang cũ so với code).

Chứng minh: test chat 60 lượt có một sự kiện ở lượt 15 và hỏi lại ở lượt 60 (trước: mất; sau: còn, nguyên văn hoặc lấy lại);
chạy benchmark một chat dài thật trên Claude Code; bảng chi phí trước/sau.

## Giai đoạn 2: Principal orglet điều phối (PR riêng)

An chốt (2026-10-07): mỗi kênh có một **principal orglet (PO)** do người dùng chỉ định. PO nhận việc, giao cho Tí phù
hợp, nhận lại kết quả, tự kiểm, có lỗi thì gửi về làm tiếp, ổn thì trả lời người dùng. Thay cho kiểu crew hiện tại
(lead lập kế hoạch → mọi thành viên → lead gộp) và kiểu thay phiên khi không tag ai.

Nguyên tắc từ nguồn: tự làm là mặc định; giao khi phần việc tự đứng được và trả về bản gọn; không chia các phần dùng
chung bối cảnh. Multi-agent tốn khoảng 15 lần token so với chat (Anthropic, báo cáo của họ).

1. **Ai nhận tin trong kênh.** Tin có tag thì Tí được tag trả lời thẳng như hiện tại. Tin không tag thì chỉ PO nhận.
   Không còn "cả kênh trả lời" và không cần Tacet chọn người.
2. **PO tự quyết làm hay giao.** Câu đơn giản PO tự trả lời (1 lời gọi). Cần chuyên môn khác thì giao 1 Tí; phần độc
   lập (so sánh, tìm nhiều nguồn) thì giao song song 2-4 Tí. Brief giao đi mang theo quyết định và ràng buộc đã chốt
   trong chat, không chỉ nhiệm vụ (bài học của Cognition), vì Tí được giao không thấy toàn bộ chat.
3. **Vòng kiểm.** Kết quả của Tí quay về PO, không tới thẳng người dùng. PO kiểm theo yêu cầu gốc (đúng câu hỏi, số
   liệu khớp nguồn, đủ phần); có lỗi thì gửi lại cho đúng Tí đó kèm nhận xét cụ thể, tối đa 2 vòng; vẫn lỗi thì trả
   lời người dùng kèm phần còn thiếu, không giấu. Mỗi vòng hiện trong phần "cách Tí làm việc" (giao cho ai, kiểm ra gì,
   gửi lại vì sao).
4. **Công cụ giao việc** (trước đây gọi tạm `ask_orglet`; đây là tên công cụ PO dùng, không phải bảng hỏi). Tí được
   giao chạy như một việc ẩn với quyền là giao của PO và của chính Tí đó (không bao giờ rộng hơn); một cấp (Tí được
   giao không giao tiếp); tiền tính vào giới hạn của chat; island hiện mặt Tí đang làm.
5. **Song song theo giới hạn kết nối** (`providerConcurrency`), thay cho số 2 cố định.
6. **Chuyển đổi.** Crew hiện có thành kênh có PO là lead cũ; kênh thay phiên chưa có PO thì hỏi người dùng chọn một
   lần (mặc định Tí đầu danh sách).
7. **Benchmark theo số Tí.** Cùng bộ bài agent-bench, chạy kênh có PO với 1, 2, 4, 8 Tí (thêm Tí nhiễu không liên
   quan); đo điểm, PO có giao đúng chuyên môn không, số lời gọi, thời gian, chi phí; so với một Tí làm một mình. Dùng
   số này để chốt quy tắc giao việc của PO.

## Giai đoạn 3: bỏ chat riêng của lịch (PR riêng)

An chốt (2026-10-07): lịch chỉ chạy trong DM của Tí hoặc trong chat nhóm, không tạo chat riêng nữa.

- Mỗi lần chạy là một lượt trong DM hoặc kênh đó, người gửi là "Lịch · tên lịch", vẫn dùng quyền và giới hạn riêng của
  lịch. Trong kênh, lượt của lịch đi qua PO như mọi tin không tag.
- Chat đang bận lúc tới giờ: lượt của lịch xếp hàng sau lượt đang chạy.
- Lịch hằng giờ không có gì mới: gộp thành một dòng gọn để không làm ngập chat.
- Các chat lịch cũ giữ lại để đọc, không chạy thêm vào đó.

## Giai đoạn 4: kết nối app, mỗi app kèm hook của nó (PR riêng)

An chốt (2026-10-07): kết nối bao nhiêu app thì có bấy nhiêu hook. Mỗi kết nối mang theo các sự kiện của nó; người
dùng bật sự kiện nào, lọc thế nào, gửi cho Tí hoặc kênh nào.

1. **OAuth cho MCP từ xa** theo spec 2026-07-28: `OAuthClientProvider` của SDK 1.32.1, token lưu bằng `safeStorage` ở
   main, redirect về `127.0.0.1` cổng ngẫu nhiên, trình duyệt hệ thống. Đăng ký: đăng ký sẵn → Client ID Metadata
   Document (`client.json` trên codepawl.com) → DCR với `application_type: native`. Tự kiểm `iss` (RFC 9207) vì SDK
   chưa làm, kiểm `state`, PKCE S256.
2. **Danh mục tự tuyển** (MCP Registry còn preview, không có trường OAuth, docs khuyên không dùng trực tiếp): GitHub,
   Linear, Notion (chỉ OAuth), Atlassian. Slack và Google chưa vào được vì cần client đã đăng ký với họ hoặc được duyệt.
3. **Hook theo từng app**, tái dùng cơ chế lịch (cấu hình đã duyệt, giới hạn ngày, payload là dữ liệu không tin cậy có
   nhãn nguồn, không cấp quyền):
   - GitHub: thông báo, PR, issue, bằng thăm dò API với `If-Modified-Since` (304 không tốn hạn mức).
   - Linear, Notion, Atlassian: thăm dò thay đổi qua API của họ (kiểm từng API lúc làm).
   - Email: IMAP IDLE (cần thêm kết nối email, chưa có).
   - Chung: webhook cục bộ trên `127.0.0.1`, mỗi hook một khóa, kiểm `Host` và `Origin`, cho app nào tự gửi được.
   - Bộ lọc mỗi hook: khớp trường hoặc từ khóa, tùy chọn Tacet "có đáng báo không"; chỉ sự kiện qua lọc mới thành
     một lượt trong DM hoặc kênh đã chọn.
4. **Đọc thông báo của app khác trên Windows** cần package identity và tiến trình phụ, chỉ Windows: để thử nghiệm
   riêng sau.

## Thứ tự đề xuất

Giai đoạn 0 → 1 → 2 → 3 → 4. Giai đoạn 0 làm được trong một buổi. 1 và 2 là lõi của hướng "một chat"; 3 cần 2 (trong
kênh, lượt của lịch đi qua PO); 4 độc lập, làm sau cùng vì lớn nhất.

## Đã chốt (An, 2026-10-07)

- Không dùng model để tóm tắt lịch sử; gửi nguyên văn theo cửa sổ model, lấy lại lượt cũ theo độ liên quan, nhớ lâu
  bằng memory.
- Kênh có principal orglet do người dùng chỉ định: nhận tin không tag, tự làm hoặc giao, kiểm và gửi lại khi còn lỗi.
- Benchmark chất lượng của PO khi số Tí tăng.
- Lịch chỉ chạy trong DM hoặc chat nhóm, bỏ chat riêng của lịch.
- Mỗi app kết nối kèm hook của nó.
- PO chỉ giao việc cho thành viên trong kênh.
- DM là của riêng một Tí: Tí trong DM không giao việc cho Tí khác và không thấy DM của Tí khác.

## Ý tưởng để sau (không thuộc plan này)

- Các Tí "kết bạn" với nhau và có quan hệ riêng, kiểu một nền tảng chat xã hội của các Tí; có thể thành nội dung đăng
  X. Cần thiết kế riêng về quyền riêng tư giữa các DM trước khi làm.

## Rủi ro

- Ngân sách lịch sử lớn hơn làm mỗi tin đắt hơn: có trần, cache prompt bù phần lặp lại, đo trước/sau.
- Lấy lại theo độ liên quan có thể bỏ sót: lượt gần vẫn nguyên văn, memory giữ chuyện quan trọng, người dùng thấy lượt
  nào được gửi trong Chi tiết (đã có manifest context).
- Tự thử lại có thể tính tiền hai lần nếu phân loại lỗi sai: chỉ thử lại các mã chắc chắn chưa xử lý.
- PO giao việc làm chi phí nhân lên: mặc định tự làm, một cấp, tiền trong giới hạn chat, benchmark chốt quy tắc.
- Vòng kiểm có thể lặp: tối đa 2 vòng gửi lại, sau đó trả lời kèm phần còn thiếu.
- Hook là cửa nhận dữ liệu từ ngoài: khóa riêng mỗi hook, kiểm Host/Origin, payload không bao giờ cấp quyền.

## Nguồn

- Anthropic prompt caching: https://platform.claude.com/docs/en/build-with-claude/prompt-caching
- Anthropic compaction: https://platform.claude.com/docs/en/build-with-claude/compaction
- Anthropic context editing: https://platform.claude.com/docs/en/build-with-claude/context-editing
- OpenAI prompt caching: https://developers.openai.com/api/docs/guides/prompt-caching
- OpenAI compaction: https://developers.openai.com/api/docs/guides/compaction
- Anthropic, multi-agent research system (2025-06-13): https://www.anthropic.com/engineering/multi-agent-research-system
- Anthropic, Building effective agents (2024-12-19): https://www.anthropic.com/engineering/building-effective-agents
- Cognition, Don't Build Multi-Agents (2025-06-12): https://cognition.com/blog/dont-build-multi-agents
- Claude Code subagents: https://code.claude.com/docs/en/sub-agents
- MCP authorization 2026-07-28: https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization
- MCP Registry: https://modelcontextprotocol.io/registry/about
- Windows notification listener: https://learn.microsoft.com/en-us/windows/apps/develop/notifications/app-notifications/notification-listener
- GitHub notifications API: https://docs.github.com/en/rest/activity/notifications

Một số con số của Anthropic/OpenAI (hệ số giá cache, tên header beta) được đọc qua công cụ tóm tắt trang; kiểm lại ở
trang gốc lúc triển khai trước khi đưa vào code.

## Tiến độ

- Giai đoạn 0 (2026-10-07): xong cả bốn việc, PR #564.
- Giai đoạn 1 (2026-10-07): ngân sách lịch sử theo cửa sổ model (`historyBudgetFor`), lượt cũ lấy lại tăng theo ngân
  sách, đọc `cached_tokens` của OpenAI vào usage. Chưa làm: TTL cache 1 giờ của Anthropic (cần đo bằng API key thật;
  AGENTS.md không cho tìm key trên máy), giá đọc cache của OpenAI (chưa kiểm ở trang giá gốc), cắt kết quả công cụ cũ
  trong harness (nguồn được trích theo dòng; cần đo trên `harness-step-cost` với công cụ thật trước).
- Giai đoạn 2 (2026-10-07): Tí trưởng tự trả lời ở bước lập kế hoạch, tin có tag đi thẳng tới Tí được tag, gửi lại
  việc kèm nhận xét (tối đa 2 lần), song song theo giới hạn kết nối, kênh mới mặc định có Tí trưởng, kế hoạch chỉ giao
  cho chính Tí trưởng thì Tí trưởng làm luôn ở bước cuối. Benchmark Claude Code, kênh 2/4/8 Tí × 3 bài: tất cả đạt sau
  khi sửa; bài đơn giản 1 lời gọi, 20-27 s (trước: 3 lời gọi, 82-305 s, có lúc trả lời trùng). Chưa đo: quy tắc giao
  việc với Cursor/Codex, và việc gửi lại trên model thật (mới có test với model giả).
- Giai đoạn 3 (2026-10-07, PR #566): mỗi lần chạy của lịch được đăng một lần vào DM của Tí hoặc chat của kênh, dưới tên
  "Lịch · tên lịch" (`ScheduleDelivery`); lần chạy vẫn giữ record riêng (quyền, thư mục, giới hạn ngày, Tacet), sidebar
  bỏ dòng của nó, thông báo mở thẳng tới bài đăng; lịch hằng giờ không có gì mới thì không đăng, Tacet thấy đáng báo mới
  đăng. Khác plan: lượt của lịch không đi qua Tí trưởng của kênh mà được đăng như câu trả lời có sẵn; chat cũ của lịch
  giữ nguyên. Cùng PR sửa lỗi sidebar ở khung hẹp bị gập lại khi chat đang mở bị xóa (alignment check fail trên CI).
- Giai đoạn 4a (2026-10-07, PR #567): đăng nhập OAuth cho MCP từ xa (main làm luồng, loopback, PKCE, `state`, `iss`,
  DCR; core tự refresh), danh mục Linear/Notion/Atlassian (trình duyệt) và GitHub (token). GitHub cần OAuth app do
  CodePawl đăng ký mới đăng nhập bằng trình duyệt được. Chưa thử đăng nhập thật với dịch vụ nào (cần người ở trình
  duyệt). Chưa làm: 4b, hook theo từng app.
- Benchmark Tí trưởng trên Codex và Cursor (2026-10-07, kênh 2 Tí, bài po-*): Codex đạt cả ba (po-simple 1 lượt 25 s,
  po-data 9/9, po-writing 6/6). Cursor đạt po-simple và po-writing; po-data 8/9 vì checker sập trong bản build qua
  junction thiếu DuckDB, Tí trưởng vẫn giao đúng cho Data analyst. Còn chưa kiểm: việc gửi lại trên model thật.
- Giai đoạn 4b (2026-10-07, PR #567): mỗi app đã kết nối có hook riêng, "Khi có mục mới trong ứng dụng": Orglet tự gọi
  một công cụ chỉ đọc theo chu kỳ, mục mới (lọc theo từ) bắt đầu một lần chạy có tệp đính kèm. Không làm: webhook cục
  bộ (app SaaS không gọi tới máy được), email IMAP (chưa có kết nối email), đọc thông báo Windows (cần package identity,
  Orglet cài bằng Squirrel).
- Kênh "lần lượt" cũ được gợi ý chọn Tí trưởng một lần. Lịch của kênh có Tí trưởng vốn đã chạy qua Tí trưởng
  (`teams.run`), không cần sửa.
