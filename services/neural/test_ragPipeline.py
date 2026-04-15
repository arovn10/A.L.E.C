"""Smoke-test for ragPipeline.get_embedding(). Run: python test_ragPipeline.py"""
import sys
import types

# Stub out sentence_transformers so test runs without the full model download
fake_module = types.ModuleType("sentence_transformers")
class FakeModel:
    def encode(self, texts, normalize_embeddings=False):
        import numpy as np
        return [np.array([0.1] * 768)]
fake_module.SentenceTransformer = lambda *a, **kw: FakeModel()
sys.modules["sentence_transformers"] = fake_module

import ragPipeline

vec = ragPipeline.get_embedding("test sentence")
assert isinstance(vec, list), "expected list"
assert len(vec) == 768, f"expected 768 dims, got {len(vec)}"
assert abs(vec[0] - 0.1) < 1e-6, "expected 0.1"
print("PASS: get_embedding returns 768-dim list")
