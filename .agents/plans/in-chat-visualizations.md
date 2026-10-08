# Plan: biểu đồ tương tác ngay trong chat

Ngày 2026-10-07. Bản ý tưởng để An xem trước khi code. Mục tiêu: Tí gửi biểu đồ (line, bar, scatter, area, pie,
histogram, heatmap) ngay trong tin nhắn; người dùng hover, zoom, bật tắt chuỗi, xem bảng số liệu, tải về, và hỏi tiếp
về một điểm. Kèm một skill để mọi Tí vẽ đúng và đẹp, không phụ thuộc model.

## Người khác làm thế nào

| Sản phẩm | Cách làm | Nhãn |
|---|---|---|
| ChatGPT (từ 05/2024) | Model viết Python (pandas, matplotlib) chạy trong sandbox, ChatGPT đổi kết quả thành biểu đồ tương tác cho bar, line, pie, scatter; loại khác thành ảnh tĩnh. Hover, đổi màu, tải về, hỏi tiếp. | báo cáo (trang gốc OpenAI trả 403) |
| Claude (beta 03/2026) | Biểu đồ và sơ đồ ngay trong cuộc trò chuyện là HTML và SVG do model viết, chạy trong iframe sandbox. Được nạp Chart.js, D3, Plotly từ vài CDN cho phép. Artifacts là tính năng cũ hơn, để chia sẻ. | báo cáo |
| Chặn iframe | JS trong `sandbox="allow-scripts"` không gỡ được thẻ meta CSP. Đây là nền của kiểu sandbox Artifacts. | đã kiểm (Simon Willison, 2026-04-03) |
| Độ đúng của spec do LLM viết | VegaChat (01/2026) kiểm tra spec Vega-Lite trước khi vẽ, gần như không còn biểu đồ hỏng. Điểm chính: **kiểm spec trước khi vẽ** mới làm kết quả đáng tin. | đã kiểm (arXiv 2601.15385) |

Hai cách khác nhau: ChatGPT để model viết code rồi app tự dựng biểu đồ; Claude để model viết HTML chạy trong iframe.
Orglet nên đi đường thứ ba, an toàn hơn cả hai cho một app trên máy người dùng: **model chỉ gửi dữ liệu và một spec
khai báo, không gửi code**; app vẽ bằng thư viện đóng gói sẵn.

## Đề xuất

### 1. Tí vẽ bằng một công cụ, không bằng HTML

Công cụ mới `show_chart` trong vòng công cụ của Orglet (chạy được với mọi kết nối, cả harness CLI, vì harness đi qua
vòng công cụ của Orglet như MCP):

- Đầu vào: loại biểu đồ, dữ liệu (bảng nhỏ, tối đa khoảng 5.000 điểm), trục, chuỗi, tiêu đề, một câu nhận xét chính.
- Core kiểm spec theo schema (zod), bỏ mọi hàm, URL và biểu thức, giới hạn kích thước. Sai thì trả lỗi cụ thể cho Tí sửa
  một lần; vẫn sai thì gửi bảng thay biểu đồ. Không bao giờ có biểu đồ trống hay hỏng trong chat.
- Biểu đồ là một phần của câu trả lời (giống tệp đính kèm), lưu trong SQLite cùng tin nhắn, có trong bản sao lưu.

Lý do không cho Tí viết HTML/JS: renderer của Orglet giữ quyền tới core qua preload; một iframe sai cấu hình là lỗ hổng.
Spec khai báo thì bề mặt tấn công chỉ còn là bộ đọc spec, và ta tự viết nó.

### 2. Định dạng: chốt bằng thử nghiệm, không đoán

Hai ứng viên, đều dùng được offline trong Electron, giấy phép hợp với app mã nguồn mở thương mại:

| | ECharts option JSON | Vega-Lite |
|---|---|---|
| Giấy phép | Apache-2.0 | BSD-3-Clause |
| Tương tác sẵn | hover, zoom, bật tắt chú thích, dataZoom, brush | tooltip, zoom/pan, chọn và lọc qua params |
| Kiểm spec | không có schema chính thức chặt | JSON Schema chặt, dễ kiểm |
| Kích thước | tree-shake được, nhỏ khi chỉ lấy vài loại | vega + vega-lite + embed khá nặng; cần bản `vega-interpreter` dưới CSP chặt |

Cách chốt: 20 yêu cầu vẽ thật × 2 định dạng × một model rẻ (và một harness), chấm theo: spec hợp lệ ngay lần đầu, đúng
loại biểu đồ, số liệu khớp. Khoảng 30 phút. Nghiêng về ECharts nếu tỷ lệ hợp lệ ngang nhau, vì tương tác giàu hơn và
nhẹ hơn khi chỉ đóng gói vài loại.

Có thể không lộ định dạng thư viện cho model: Tí điền một spec riêng của Orglet, gọn (loại, dữ liệu, trục, chuỗi), core
dịch sang ECharts hoặc Vega-Lite. Spec nhỏ thì model ít sai hơn, và sau này đổi thư viện không phải sửa skill.

### 3. Trong chat trông và dùng thế nào

- Biểu đồ nằm trong khung câu trả lời, rộng bằng cột chat, cao vừa đủ, theo token màu của app (sáng và tối riêng).
- Trên khung: tiêu đề và câu nhận xét chính. Dưới khung: chú thích (từ 2 chuỗi trở lên), nhãn trực tiếp khi tối đa 4
  chuỗi.
- Hover hiện tooltip; line và area có đường dóng. Kéo để zoom, nhấp đúp để về như cũ. Bấm vào chú thích để ẩn hoặc hiện
  chuỗi.
- Nút nhỏ: **Bảng** (xem số liệu, dùng lại bảng của trình xem CSV vừa làm), **Tải về** (PNG và CSV), **Mở lớn**
  (trình xem riêng như tệp).
- **Hỏi về điểm này**: bấm một điểm hoặc cột thì đưa trích dẫn giá trị đó vào ô nhập, giống trả lời một tin.
- Biểu đồ không vẽ được thì hiện bảng và một dòng lý do có biểu tượng, không bao giờ để khung trống.

### 4. Skill "Vẽ biểu đồ" cho mọi Tí

Một skill có sẵn (bật theo quyền, như các skill khác), dựa trên phương pháp của skill `dataviz` mà phiên này có:

1. **Chọn dạng trước, màu sau cùng.** Thời gian thì line, so sánh nhóm thì bar từ 0, quan hệ thì scatter, phân bố thì
   histogram, pie chỉ khi tối đa 5 phần cộng thành một tổng. Đôi khi câu trả lời là một con số, không phải biểu đồ.
2. **Không bao giờ hai trục y.** Hai đại lượng khác thang thì hai biểu đồ.
3. **Màu theo đối tượng, không theo thứ hạng**, thứ tự cố định. Từ chuỗi thứ 9 trở đi thì gộp vào "Khác". Bảng màu do
   app cấp (đã chạy validator cho người mù màu, sáng và tối), Tí không tự chọn mã màu.
4. **Gộp dữ liệu trước khi vẽ.** Từ tệp đính kèm thì dùng checker cục bộ (DuckDB) để tính tổng, trung bình, nhóm rồi
   mới vẽ kết quả. Không gửi 100.000 điểm thô.
5. **Luôn kèm một câu nhận xét và bảng số liệu.** Người dùng trình đọc màn hình đọc được, và khi biểu đồ lỗi vẫn còn
   bảng.
6. **Kiểm trước khi gửi**: công cụ tự kiểm; skill dạy cách đọc lỗi và sửa một lần.

Skill nằm trong danh mục skill có sẵn và marketplace sau này. Tí nào bật quyền "đọc tệp đính kèm" và "kiểm dữ liệu" thì
vẽ được từ tệp.

### 5. Bảo mật

- Không có code từ model: không HTML, không JS, không hàm formatter, không URL nguồn dữ liệu.
- Spec qua zod ở core; renderer chỉ nhận spec đã kiểm.
- Giới hạn: số điểm, số chuỗi, độ dài nhãn, kích thước JSON.
- Để sau, nếu An muốn "biểu đồ tùy ý" kiểu Claude: iframe `sandbox="allow-scripts"` không có `allow-same-origin`,
  origin riêng qua protocol tùy chỉnh, CSP thẻ meta `default-src 'none'` và `connect-src 'none'`, dữ liệu qua
  `postMessage`, không preload. Không làm trong lần đầu.

## Các bước

1. **Thử nghiệm định dạng** (S): 20 yêu cầu × ECharts và Vega-Lite, một model rẻ. Chốt định dạng và spec riêng của
   Orglet.
2. **Công cụ `show_chart` và bộ vẽ** (M): schema, kiểm, dịch spec, phần đính kèm biểu đồ trong tin nhắn, 6 loại đầu
   (line, bar, area, scatter, pie, histogram), sáng và tối, tooltip, zoom, bật tắt chuỗi, nút Bảng và Tải về. Có màn
   alignment check, test schema, smoke đóng gói.
3. **Skill "Vẽ biểu đồ"** (S): quy tắc ở mục 4, bảng màu đã validate, ví dụ. Benchmark agent-bench có thêm bài vẽ: chấm
   spec hợp lệ, đúng loại, số khớp nguồn.
4. **Dữ liệu từ tệp** (M): nối với checker để gộp trước khi vẽ; "Hỏi về điểm này".
5. **Mở lớn và xuất** (S): trình xem riêng, PNG và CSV, đưa vào tab Tệp của chat.

## An quyết

- Có cần chế độ "biểu đồ tùy ý" (HTML trong iframe) như Claude không, hay chỉ spec khai báo. Đề xuất: chỉ spec, ít
  nhất ở bản đầu.
- Định dạng: để thử nghiệm ở bước 1 quyết.

## Nguồn

- Simon Willison, CSP trong iframe sandbox (2026-04-03): https://simonwillison.net/2026/Apr/3/test-csp-iframe-escape/
- VegaChat (2026-01-21): https://arxiv.org/abs/2601.15385
- Text2Vis: https://arxiv.org/html/2507.19969v1
- Electron security: https://www.electronjs.org/docs/latest/tutorial/security
- OpenAI, Improvements to data analysis in ChatGPT (05/2024): https://openai.com/index/improvements-to-data-analysis-in-chatgpt
  (không mở được, 403; nội dung theo các trang khác)
- Anthropic, Claude creates interactive charts (03/2026), theo kết quả tìm kiếm và PC World; trang gốc không mở được.
- Giấy phép và kích thước gói: `npm view`, 2026-10-07.

## Tiến độ

- 2026-10-07: làm bước 2 và 3 theo cách gọn hơn plan. Không thêm công cụ `show_chart`: Tí viết khối ```chart trong câu
  trả lời bằng spec riêng của Orglet (`shared/charts.ts`), công cụ `reply` kiểm và gửi lại lỗi một lần, nên mọi provider
  và harness đều vẽ được mà không đổi vòng công cụ. Định dạng chốt không cần thử nghiệm: model không viết cú pháp thư
  viện, nên chọn ECharts 6.1.0 (Apache-2.0, tree-shake, không `eval`) cho phần vẽ. Có line, area, bar, scatter, pie,
  histogram; hover, zoom, bật tắt chuỗi; Bảng, lưu PNG, lưu CSV; bảng màu dataviz đã chạy validator trên nền của app.
  "Skill" là hướng dẫn gắn vào mô tả công cụ `reply`. Chưa làm: bài benchmark vẽ biểu đồ trên model thật.
- 2026-10-07 (cùng ngày, nhánh feat/charts-more): làm nốt bước 4 và 5.
  - **Hỏi về điểm này**: bấm điểm, cột hoặc miếng bánh thì `ChartBlock` gọi `onAskPoint` với một dòng trích (biểu đồ, chuỗi,
    vị trí trên trục, giá trị); `ChatReply` đưa dòng đó vào ô nhập qua `replyToChartPoint` (cùng chỗ với "Trả lời tin
    này") và khi gửi, dòng đi trước câu hỏi để Tí biết điểm nào. Line và area dùng click lên vùng vẽ, đổi ra hạng mục gần
    nhất và chuỗi gần con trỏ nhất, vì đường không có điểm để bấm giữa các ký hiệu.
  - **Gộp từ tệp**: `profile_dataset` có thêm `aggregate` (cột nhóm, bucket ngày/tháng/năm, sum/avg/min/max/count, tối đa
    200 nhóm). SQL do `profiler/aggregate.ts` tự dựng, cột phải có trong tệp, không SQL tự do. Kết quả là
    `DatasetProfile.aggregate`. Hướng dẫn của `reply` bảo Tí vẽ từ các dòng đó, không đọc hay dán dòng thô. Không thêm công
    cụ mới.
  - **Mở lớn**: nút trong đầu biểu đồ mở `ChartViewer` (cùng `SourceViewer` mà tệp dùng). Từ trình xem, bấm điểm cũng hỏi
    được và đóng trình xem.
  - **Tab Tệp**: `chartsOfChat` (`chatViews.ts`) lấy biểu đồ từ nội dung các câu trả lời, không thêm bảng; số trên menu Tệp
    cộng cả biểu đồ.
- 2026-10-09: benchmark vẽ biểu đồ trên model thật (`tests/live/chart-replies.test.ts`, 12 yêu cầu, chỉ có hướng dẫn chart của công cụ reply): `gpt-6-luna` và `gpt-6.1-sol` đều 12/12 gửi biểu đồ hợp lệ ngay lần đầu, đúng dạng, giữ nguyên số. Hai lần đầu lộ ra histogram chỉ ghi cột giá trị ở `x` (hoặc `y` rỗng); app giờ tự hiểu cột đó là giá trị (`shared/charts.ts`). Hai đại lượng khác thang được model tách thành hai biểu đồ, đúng hướng dẫn.
