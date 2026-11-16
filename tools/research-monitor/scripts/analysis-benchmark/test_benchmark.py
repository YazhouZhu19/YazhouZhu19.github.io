import unittest
import numpy as np
from scipy.sparse import csr_matrix
from run import bootstrap, clean, metrics, niche_gate, npmi, stability


class BenchmarkTests(unittest.TestCase):
    def test_identifier_masking(self):
        self.assertEqual(clean("A https://github.com/x/y. 10.1234/abcd 2401.12345v2 <b>CT</b>"), "a ct")

    def test_no_credit_for_zero_similarity(self):
        self.assertEqual(metrics(np.array([0., 0.]), {0}), {"recall10": 0, "hit10": 0, "mrr": 0})

    def test_multi_positive_recall(self):
        m = metrics(np.arange(12, 0, -1), {0, 11})
        self.assertEqual(m["recall10"], .5)
        self.assertEqual(m["mrr"], 1)

    def test_npmi_anticorrelation_and_identical_terms(self):
        x = csr_matrix([[1, 1, 0], [1, 1, 0], [0, 0, 1], [0, 0, 1]])
        self.assertAlmostEqual(npmi([[0, 1]], x)[0], 1)
        self.assertEqual(npmi([[0, 2]], x)[0], -1)

    def test_topic_permutation(self):
        self.assertEqual(stability([[1,2], [3,4]], [[3,4], [1,2]]), 1)

    def test_paired_bootstrap_constant(self):
        self.assertEqual(bootstrap([.2]*4)["ci95"], [.2,.2])

    def test_niche_data_history_is_required(self):
        f=[{"id":str(i), "date":d, "data":["shared"], "hasDataSentence":True, "logic":True, "code":["repo"]} for i,d in enumerate(["2022-01-01", "2023-01-01", "2024-01-01"])]
        self.assertTrue(niche_gate([0,1,2], f, 100)["ready"])
        for p in f:
            p["data"]=[]
        self.assertFalse(niche_gate([0,1,2], f, 100)["ready"])


if __name__ == "__main__":
    unittest.main()
