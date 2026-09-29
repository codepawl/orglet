/**
 * Words of three letters or more that say nothing about which note a message is about (COD-307). Shorter words never
 * count, so they are not listed. Vietnamese words are single syllables in NFC form.
 */
const ENGLISH = [
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'any', 'can', 'had', 'her', 'was', 'one', 'our', 'out', 'has',
  'him', 'his', 'how', 'its', 'may', 'now', 'own', 'she', 'too', 'who', 'why', 'yes', 'get', 'got', 'let', 'did', 'does',
  'done', 'doing', 'about', 'above', 'after', 'again', 'also', 'been', 'before', 'being', 'below', 'between', 'both',
  'could', 'each', 'few', 'from', 'have', 'having', 'here', 'hers', 'herself', 'himself', 'into', 'itself', 'just', 'more',
  'most', 'much', 'must', 'myself', 'only', 'other', 'ours', 'over', 'same', 'should', 'some', 'such', 'than', 'that',
  'their', 'theirs', 'them', 'then', 'there', 'these', 'they', 'this', 'those', 'through', 'under', 'until', 'very',
  'were', 'what', 'when', 'where', 'which', 'while', 'whom', 'will', 'with', 'would', 'your', 'yours', 'yourself', 'off',
  'once', 'nor', 'per', 'via', 'etc', 'please', 'thanks', 'thank', 'hey', 'hello', 'okay',
  // What is left of a contraction once the apostrophe splits it: "don't" gives "don".
  'don', 'doesn', 'didn', 'isn', 'aren', 'wasn', 'weren', 'won', 'wouldn', 'couldn', 'shouldn', 'haven', 'hasn', 'hadn',
];

const VIETNAMESE = [
  'của', 'được', 'những', 'các', 'cho', 'này', 'với', 'không', 'thì', 'một', 'trong', 'khi', 'như', 'nhưng', 'hay',
  'hoặc', 'nào', 'thế', 'nên', 'vào', 'rồi', 'cũng', 'còn', 'đang', 'đây', 'kia', 'mình', 'bạn', 'tôi', 'chúng', 'anh',
  'chị', 'ông', 'cái', 'rất', 'vẫn', 'lại', 'theo', 'trên', 'sau', 'trước', 'giúp', 'hãy', 'xin', 'nhé', 'nhỉ', 'vậy',
  'thôi', 'luôn', 'chưa', 'đều', 'bằng', 'tại', 'nếu', 'hơn', 'đến', 'bởi', 'thêm', 'đấy', 'nhờ', 'dùm', 'giùm',
];

export const STOP_WORDS: ReadonlySet<string> = new Set([...ENGLISH, ...VIETNAMESE]);
