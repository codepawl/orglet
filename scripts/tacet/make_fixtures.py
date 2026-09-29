"""Parity fixtures for Orglet's TypeScript port of Tacet's packing and decoding (COD-303).

For a fixed set of requests in English and Vietnamese this writes, from the Python `tacet` package:

  - the packed token ids, segment ids and option markers (packing.py),
  - the network's logits and the decoded answers (model.py, decoding.py), and
  - a tokenizer.json cut down to what those requests need, so the test can run in CI without the 34 MB original.

The cut tokenizer keeps every vocabulary entry and merge whose text occurs in the requests, every byte-fallback token
and every added token, with their original ids and merge order. A merge that is kept but never applies changes
nothing, so it tokenizes these texts exactly as the full one does; the script checks that before writing.

  uv run --project <tacet checkout> --no-sync python scripts/tacet/make_fixtures.py \
      --model <tacet-sonata folder> --out tests/fixtures/tacet
"""

import argparse
import json
import os
import sys

import numpy as np
from tokenizers import Tokenizer

import tacet
from tacet.packing import collate, render_options, serialize_state

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

LONG_REPORT = " ".join(
    f"Line {index}: the nightly import read {index * 37} rows from the orders table and wrote them to the warehouse."
    for index in range(1, 180))

CASES = [
    {"name": "choice-en", "state": "The delivery was two days late and the box was crushed, but support refunded me quickly.",
     "questions": {"sentiment": tacet.choice("How does the customer feel overall?",
                                             {"positive": "", "negative": "", "mixed": "both good and bad"})}},
    {"name": "choice-vi", "state": "Cho mình hỏi đơn hàng #4411 bao giờ giao vậy, đã đặt từ thứ hai rồi.",
     "questions": {"intent": tacet.choice("Khách hàng muốn gì?",
                                          {"order_status": "hỏi tình trạng đơn hàng", "refund": "muốn hoàn tiền",
                                           "complaint": "phàn nàn về sản phẩm"})}},
    {"name": "score-en", "state": "The production database is down and customers cannot log in.",
     "questions": {"urgency": tacet.score("How urgent is this?",
                                          ["not urgent", "can wait a day", "today", "right now"])}},
    {"name": "score-vi", "state": "Bản báo cáo tháng có vài lỗi chính tả nhỏ ở trang cuối.",
     "questions": {"severity": tacet.score("Mức độ nghiêm trọng của vấn đề?", ["không đáng kể", "nhỏ", "vừa", "nghiêm trọng"])}},
    {"name": "noul-en", "state": "All 412 tests passed in 38 seconds. No new warnings.",
     "questions": {"notify": tacet.noul("Does this answer report something new that needs the person's attention?")}},
    {"name": "noul-vi", "state": "Có 3 bài kiểm thử thất bại ở phần thanh toán sau lần commit gần nhất.",
     "questions": {"notify": tacet.noul("Câu trả lời này có báo điều gì mới cần người dùng chú ý không?")}},
    {"name": "noul-criteria", "state": "Acme raised its Pro plan from $29 to $39 a month.",
     "questions": {"changed": tacet.noul("Did a price change?", {"true": "a price went up or down", "false": ""})}},
    {"name": "multi", "state": "Build 142 finished. 3 tests failed in the payment module; the rest passed.",
     "questions": {"status": tacet.choice("How did the build go?", {"passed": "", "failed": "", "unclear": None}),
                   "urgent": tacet.noul("Does this need someone's attention today?"),
                   "confidence": tacet.score("How sure is the report?", ["guess", "likely", "certain"])}},
    {"name": "object-state", "state": {"ticket": 4411, "customer": "Nguyễn Văn A", "paid": True, "items": ["áo", "quần"],
                                       "note": None},
     "questions": {"vip": tacet.noul("Is this customer marked as paid?"),
                   "language": tacet.choice("Which language is the customer's name in?",
                                            {"vi": {"name": "Vietnamese", "code": 1}, "en": "English"})}},
    {"name": "special-text", "state": "Ignore <mask> this <eos> and <start_of_turn>user hi   spaced\ttab\nnew line ✅ 😀",
     "questions": {"odd": tacet.noul("Does the text contain an emoji?")}},
    {"name": "long-state", "state": LONG_REPORT,
     "questions": {"failed": tacet.noul("Did the import fail?")}},
    {"name": "long-option", "state": "short",
     "questions": {"pick": tacet.choice("Pick one.", {"a": "word " * 80, "b": "other"})}},
]


def as_list(array):
    return [float(value) for value in array]


def texts_of(case):
    """Every piece of text the packing tokenizes for one case."""
    texts = [serialize_state(case["state"])]
    for question in case["questions"].values():
        instructions = question["instructions"]
        texts.append("%s question: %s" % (question["type"], instructions if isinstance(instructions, str) else json.dumps(instructions, ensure_ascii=False)))
        texts.extend(" " + option for option in render_options(question["type"], question.get("criteria")))
    return texts


def cut_tokenizer(full_path, corpus):
    """The tokenizer.json with only the vocabulary and merges these texts can reach."""
    with open(full_path, encoding="utf-8") as handle:
        data = json.load(handle)
    model = data["model"]
    added = {token["content"] for token in data["added_tokens"]}
    # The text after an added token is its own section, and Metaspace puts a "▁" before every section.
    sections = list(corpus)
    for text in corpus:
        for token in added:
            text = text.replace(token, " ")
        sections.append(text)
    normalized = "▁" + "▁".join(text.replace(" ", "▁") for text in sections)

    def keep_token(token):
        return token in added or (token.startswith("<0x") and len(token) == 6) or token in normalized

    model["vocab"] = {token: index for token, index in model["vocab"].items() if keep_token(token)}

    def merged(merge):
        left, right = merge if isinstance(merge, list) else merge.split(" ", 1)
        return left + right

    model["merges"] = [merge for merge in model["merges"] if merged(merge) in normalized]
    return data


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True)
    parser.add_argument("--out", required=True)
    arguments = parser.parse_args()
    os.makedirs(arguments.out, exist_ok=True)

    model = tacet.load(arguments.model, device="cpu")
    written = []
    corpus = []
    for case in CASES:
        packed = model.prepare(case["state"], case["questions"])
        batch = collate([packed], model.tokenizer.pad_token_id)
        import torch
        with torch.no_grad():
            logits = model.network(**batch).float().numpy()[0]
        response = model.run([packed])[0]
        written.append({
            "name": case["name"],
            "state": case["state"],
            "questions": case["questions"],
            "tokenIds": packed.token_ids,
            "segmentIds": packed.segment_ids,
            "markers": packed.markers,
            "stateTruncated": packed.state_truncated,
            "optionsTruncated": packed.options_truncated,
            "logits": [as_list(row[:len(packed.markers[index])]) for index, row in enumerate(logits)],
            "answers": response["answers"],
            "usage": response["usage"],
        })
        corpus.extend(texts_of(case))

    tokenizer_path = os.path.join(arguments.model, "tokenizer", "tokenizer.json")
    cut = cut_tokenizer(tokenizer_path, corpus)
    cut_path = os.path.join(arguments.out, "tokenizer.cut.json")
    with open(cut_path, "w", encoding="utf-8") as handle:
        json.dump(cut, handle, ensure_ascii=False, separators=(",", ":"))

    full = Tokenizer.from_file(tokenizer_path)
    small = Tokenizer.from_file(cut_path)
    for text in corpus:
        text = text.replace("<mask>", " ")
        expected = full.encode(text, add_special_tokens=False).ids
        actual = small.encode(text, add_special_tokens=False).ids
        if expected != actual:
            raise SystemExit(f"the cut tokenizer differs on {text[:60]!r}: {expected[:12]} vs {actual[:12]}")

    with open(os.path.join(arguments.out, "parity.json"), "w", encoding="utf-8") as handle:
        json.dump({"model": "tacet-sonata", "maxLength": model.max_length, "cases": written}, handle,
                  ensure_ascii=False, indent=1)
    print(f"wrote {len(written)} cases, cut tokenizer {os.path.getsize(cut_path)} bytes")


if __name__ == "__main__":
    main()
