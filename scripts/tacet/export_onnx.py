"""Export Tacet (codepawl/tacet-sonata) to ONNX for Orglet's on-device decisions (COD-303).

Writes two files next to each other:

  tacet-sonata-fp32.onnx              the network as trained, float32 (580 MB)
  tacet-sonata-int8-embeddings.onnx   the file Orglet downloads: the 256k-token embedding table as int8 and every
                                      other weight float32 (285 MB)

Quantizing the matrix multiplications too (dynamic int8 on MatMul) halved the file again but changed answers by up
to 0.6 in probability; float16 weights were slower on the CPU and needed a repaired converter output. The numbers
are in docs/implementation_status.md.

The graph takes the five tensors Tacet's collate() builds (input_ids, attention_mask, segment_ids,
marker_positions, marker_mask) and returns the [batch, questions, options] logits, so the packing and decoding in
apps/desktop/src/core/decisions/ stay the only code that turns text into answers.

Run on the CPU, from the Tacet checkout:

  uv run --project <tacet checkout> --no-sync python scripts/tacet/export_onnx.py \
      --model <tacet-sonata folder> --out <folder>
"""

import argparse
import hashlib
import os
import sys

import torch

import tacet
from tacet.packing import collate

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

INPUT_NAMES = ["input_ids", "attention_mask", "segment_ids", "marker_positions", "marker_mask"]


class ExportedNetwork(torch.nn.Module):
    """TacetNetwork with positional inputs, which is what the exporter wants."""

    def __init__(self, network):
        super().__init__()
        self.network = network

    def forward(self, input_ids, attention_mask, segment_ids, marker_positions, marker_mask):
        return self.network(input_ids, attention_mask, segment_ids, marker_positions, marker_mask)


def sample_batch(model):
    """Two questions of different sizes, so the question and option axes are not fixed at 1."""
    state = "Build 142 finished. 3 tests failed in the payment module; the rest passed."
    questions = {
        "status": tacet.choice("How did the build go?", {"passed": "", "failed": "", "unclear": ""}),
        "urgent": tacet.noul("Does this need someone's attention today?"),
    }
    packed = model.prepare(state, questions)
    return collate([packed], model.tokenizer.pad_token_id)


def export_fp32(model, path):
    # The fused encoder-layer kernel has no ONNX form; without the fast path the head traces as plain attention.
    torch.backends.mha.set_fastpath_enabled(False)
    network = ExportedNetwork(model.network).eval()
    batch = sample_batch(model)
    arguments = tuple(batch[name] for name in INPUT_NAMES)
    batch_axis = torch.export.Dim("batch", min=1, max=64)
    sequence_axis = torch.export.Dim("sequence", min=8, max=4096)
    question_axis = torch.export.Dim("questions", min=1, max=32)
    option_axis = torch.export.Dim("options", min=2, max=64)
    dynamic_shapes = {
        "input_ids": {0: batch_axis, 1: sequence_axis},
        "attention_mask": {0: batch_axis, 1: sequence_axis},
        "segment_ids": {0: batch_axis, 1: sequence_axis},
        "marker_positions": {0: batch_axis, 1: question_axis, 2: option_axis},
        "marker_mask": {0: batch_axis, 1: question_axis, 2: option_axis},
    }
    with torch.no_grad():
        program = torch.onnx.export(network, arguments, input_names=INPUT_NAMES, output_names=["logits"],
                                    dynamic_shapes=dynamic_shapes, dynamo=True, opset_version=18)
    program.optimize()
    program.save(path, external_data=False)


def quantize_embeddings(source, target):
    """Dynamic int8 on the Gather (embedding lookup) weights only."""
    from onnxruntime.quantization import QuantType, quantize_dynamic

    quantize_dynamic(source, target, weight_type=QuantType.QInt8, op_types_to_quantize=["Gather"], per_channel=False)


def sha256_of(path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True, help="the tacet-sonata folder (config.json, model.safetensors, ...)")
    parser.add_argument("--out", required=True)
    arguments = parser.parse_args()
    os.makedirs(arguments.out, exist_ok=True)
    torch.set_num_threads(max(1, (os.cpu_count() or 2) // 2))

    model = tacet.load(arguments.model, device="cpu")
    fp32_path = os.path.join(arguments.out, "tacet-sonata-fp32.onnx")
    shipped_path = os.path.join(arguments.out, "tacet-sonata-int8-embeddings.onnx")

    print("exporting fp32")
    export_fp32(model, fp32_path)
    print("quantizing the embedding table")
    quantize_embeddings(fp32_path, shipped_path)
    for path in (fp32_path, shipped_path):
        print(f"{os.path.basename(path)}  {os.path.getsize(path)} bytes  sha256 {sha256_of(path)}")


if __name__ == "__main__":
    main()
