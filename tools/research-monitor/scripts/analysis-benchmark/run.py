"""Offline classical-method benchmark. No network, LLM, embeddings or AI labels.

Run from the research-monitor root with the pinned requirements installed.
All source text is read from the audit export, never from provisional annotations.
"""
import argparse
import collections
import hashlib
import itertools
import json
import math
import platform
import re
import time
import warnings
from pathlib import Path

import numpy as np
import scipy
import sklearn
from scipy.optimize import linear_sum_assignment
from scipy.sparse import csr_matrix
from sklearn.decomposition import NMF, LatentDirichletAllocation
from sklearn.feature_extraction.text import CountVectorizer, TfidfTransformer
from sklearn.metrics import adjusted_rand_score
from sklearn.preprocessing import normalize
from threadpoolctl import threadpool_limits


def digest(s):
    return hashlib.sha256(s.encode()).hexdigest()


def clean(text):
    text = re.sub(r"https?://[^\s<>]+|www\.[^\s<>]+", " ", text)
    text = re.sub(r"10\.\d{4,9}/\S+|\b\d{4}\.\d{4,5}(?:v\d+)?\b", " ", text)
    text = re.sub(r"<[^>]*>", " ", text)
    return re.sub(r"\s+", " ", text).strip().lower()


def npmi(topics, binary):
    """Document-level NPMI, not sliding-window c_npmi; unseen pairs = -1."""
    n = binary.shape[0]
    result = []
    for terms in topics:
        b = binary[:, terms].astype(np.float64)
        df = np.asarray(b.sum(axis=0)).ravel()
        joint = (b.T @ b).toarray()
        vals = []
        for i, j in itertools.combinations(range(len(terms)), 2):
            p = joint[i, j] / n
            if p == 0:
                vals.append(-1.)
            elif p == 1:
                vals.append(1.)
            else:
                vals.append(math.log(p / ((df[i] / n) * (df[j] / n))) / -math.log(p))
        result.append(float(np.mean(vals)) if vals else None)
    return result


def top_terms(components, n):
    return [np.argsort(-c, kind="stable")[:n].tolist() for c in components]


def stability(a, b):
    matrix = np.array([[len(set(x) & set(y)) / len(set(x) | set(y)) for y in b] for x in a])
    i, j = linear_sum_assignment(-matrix)
    return float(matrix[i, j].mean())


def metrics(scores, positives):
    # Gallery has stable ID order; zero scores do not count as retrieved evidence.
    order = np.argsort(-scores, kind="stable")
    ranks = [i + 1 for i, v in enumerate(order) if v in positives and scores[v] > 0]
    return {"recall10": sum(r <= 10 for r in ranks) / len(positives),
            "hit10": float(any(r <= 10 for r in ranks)),
            "mrr": 1. / min(ranks) if ranks else 0.}


def bootstrap(values, seed=42, clusters=None):
    if not values:
        return {"mean": None, "ci95": None, "n": 0}
    a = np.asarray(values)
    rng = np.random.default_rng(seed)
    if clusters is None:
        b = a[rng.integers(0, len(a), size=(2000, len(a)))].mean(axis=1)
        group_count = len(a)
    else:
        units = [[j for j,c in enumerate(clusters) if c == g] for g in sorted(set(clusters))]
        group_count = len(units)
        b = np.array([a[[j for u in sample for j in units[u]]].mean() for sample in rng.integers(0, len(units), size=(2000,len(units)))])
    return {"mean": float(a.mean()), "ci95": np.quantile(b, [.025, .975]).tolist(), "n": len(a), "independentGroups": group_count}


def niche_gate(members, features, total):
    f = [features[i] for i in members]
    dates = sorted(p["date"] for p in f)
    def days(a, b):
        return int((np.datetime64(b) - np.datetime64(a)) / np.timedelta64(1, "D"))
    ds = collections.defaultdict(list)
    for p in f:
        for key in p["data"]:
            ds[key].append(p["date"])
    data_span = max([0] + [days(min(v), max(v)) for v in ds.values()])
    gates = {"history": len(f) >= 3 and days(dates[0], dates[-1]) >= 730 and len({d[:4] for d in dates}) >= 3,
             "logic": sum(p["logic"] for p in f) >= 2,
             "data": any(p["hasDataSentence"] for p in f) and data_span >= 365,
             "code": any(p["code"] for p in f)}
    return {"count": len(f), "share": len(f) / total, "spanDays": days(dates[0], dates[-1]),
            "years": sorted({d[:4] for d in dates}), "dataSpanDays": data_span,
            "logicPapers": sum(p["logic"] for p in f), "codeIds": sorted({c for p in f for c in p["code"]}),
            "gates": gates, "ready": all(gates.values()), "paperIds": [p["id"] for p in f]}


def summarize_niches(groups, features, label):
    candidates = []
    for key, members in groups.items():
        if members and len(members) / len(features) < .1:
            candidates.append({"id": str(key), **niche_gate(members, features, len(features))})
    names = ["history", "logic", "data", "code"]
    return {"method": label, "candidateCount": len(candidates),
            "passEach": {g: sum(c["gates"][g] for c in candidates) for g in names},
            "passAll": sum(c["ready"] for c in candidates),
            "leaveOneGateOut": {g: sum(all(c["gates"][h] for h in names if h != g) for c in candidates) for g in names},
            "candidates": candidates}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--corpus", default="/private/tmp/oevryn-analysis-corpus.json")
    parser.add_argument("--output", default="eval/analysis-benchmark")
    args = parser.parse_args()
    out = Path(args.output)
    out.mkdir(parents=True, exist_ok=True)
    cfg = json.loads(Path("eval/analysis-benchmark/protocol.json").read_text())
    data = json.loads(Path(args.corpus).read_text())
    rows = data["rows"]
    texts = [clean(r["text"]) for r in rows]
    n = len(rows)
    parents = list(range(n))
    def root(i):
        while parents[i] != i:
            parents[i] = parents[parents[i]]
            i = parents[i]
        return i
    def join(a, b):
        parents[root(a)] = root(b)
    key_index, exact_index = {}, {}
    for i, r in enumerate(rows):
        for key in r["keys"]:
            if key in key_index:
                join(i, key_index[key])
            key_index[key] = i
        key = texts[i]
        if key and key in exact_index:
            join(i, exact_index[key])
        exact_index[key] = i
    components = collections.defaultdict(list)
    for i in range(n):
        components[root(i)].append(i)
    component_ids = {k: min(rows[i]["id"] for i in members) for k, members in components.items()}
    held = np.array([int(digest(component_ids[root(i)])[:8], 16) % 5 == 0 for i in range(n)])
    # One exact normalized-text representative per kind for training/testing, all rows retained for native baseline.
    unique = []
    seen = set()
    for i in sorted(range(n), key=lambda i: rows[i]["id"]):
        key = (rows[i]["kind"], texts[i])
        if key not in seen:
            unique.append(i)
            seen.add(key)
    train, test = [], []
    for kind in ["paper", "github", "news"]:
        pool = sorted([i for i in unique if rows[i]["kind"] == kind and rows[i]["inWindow"]], key=lambda i: digest(rows[i]["id"]))
        train += [i for i in pool if not held[i]][:cfg["trainCapPerSource"]]
        test += [i for i in pool if held[i]][:cfg["testCapPerSource"]]
    assert not ({root(i) for i in train} & {root(i) for i in test})
    rules = np.array([r["maskedRule"] for r in rows], dtype=float)
    vec = CountVectorizer(stop_words="english", token_pattern=r"(?u)\b[a-z][a-z0-9_]{2,}\b", min_df=cfg["minDf"], max_df=cfg["maxDf"], max_features=cfg["maxFeatures"])
    ctr = vec.fit_transform([texts[i] for i in train])
    counts = vec.transform(texts)
    tf = TfidfTransformer(sublinear_tf=True)
    tf.fit(ctr)
    X = tf.transform(counts)
    words = vec.get_feature_names_out()
    binary_test = (counts[test] > 0).astype(np.int32)
    features = data["features"]
    paper_index = {r["id"]: i for i, r in enumerate(rows) if r["kind"] == "paper"}
    pi = np.array([paper_index[p["id"]] for p in features])
    direction_models, representations, fitted = [], {"rules": normalize(rules)}, {}
    baseline_components = np.vstack([np.asarray(X[np.array(train)[rules[train, k] > 0]].mean(axis=0)).ravel() for k in range(7)])
    rule_words = top_terms(baseline_components, cfg["topWords"])
    rule_coherence = npmi(rule_words, binary_test)
    direction_models.append({"method": "rules", "k": 7, "seed": None, "npmi": float(np.mean(rule_coherence)), "topicNpmi": rule_coherence,
                             "diversity": len(set(sum(rule_words, []))) / 70,
                             "topWords": [[words[j] for j in t] for t in rule_words], "seconds": None,
                             "centroidNpmi": float(np.mean(rule_coherence)), "centroidWords": [[words[j] for j in t] for t in rule_words], "centroidNonemptyTopics": 7})
    groups = collections.defaultdict(list)
    for i, p in enumerate(features):
        for key in p["niches"]:
            groups[key].append(i)
    niche_results = [summarize_niches(groups, features, "rules")]
    # Independent evidence-gate implementation must reproduce every existing niche.
    native = {c["id"]: c for c in data["baseline"]["niches"]}
    assert len(native) == niche_results[0]["candidateCount"]
    for c in niche_results[0]["candidates"]:
        for key in ["count", "spanDays", "dataSpanDays", "logicPapers", "ready"]:
            assert c[key] == native[c["id"]][key], (c["id"], key)
    print(json.dumps({"stage": "prepared", "rows": n, "train": len(train), "test": len(test), "vocab": len(words)}, ensure_ascii=False), flush=True)
    # Topic diagnostics use identical train/test text; NMF gets TF-IDF, LDA gets counts.
    for method in ["nmf", "lda"]:
        for k in cfg["topics"]:
            for seed in cfg["modelSeeds"]:
                begin = time.perf_counter()
                model = (NMF(n_components=k, init="nndsvdar", random_state=seed, max_iter=cfg["nmfMaxIter"], tol=1e-4)
                         if method == "nmf" else LatentDirichletAllocation(n_components=k, random_state=seed, max_iter=cfg["ldaMaxIter"], learning_method="batch", n_jobs=1))
                input_matrix = X if method == "nmf" else counts
                with warnings.catch_warnings(record=True) as caught:
                    warnings.simplefilter("always")
                    model.fit(input_matrix[train])
                    test_rep = model.transform(input_matrix[test])
                    train_rep = model.transform(input_matrix[train])
                terms = top_terms(model.components_, cfg["topWords"])
                coherence = npmi(terms, binary_test)
                # Common representation: TF-IDF centroids for all methods' assigned training groups.
                # Rules allow overlapping groups; learned methods use the dominant topic.
                centroids = [np.asarray(X[np.array(train)[train_rep.argmax(axis=1) == j]].mean(axis=0)).ravel() for j in range(k) if np.any(train_rep.argmax(axis=1) == j)]
                centroid_terms = top_terms(centroids, cfg["topWords"])
                centroid_coherence = npmi(centroid_terms, binary_test)
                result = {"method": method, "k": k, "seed": seed, "npmi": float(np.mean(coherence)), "topicNpmi": coherence,
                          "diversity": len(set(sum(terms, []))) / (k * cfg["topWords"]),
                          "topWords": [[words[j] for j in t] for t in terms], "seconds": time.perf_counter() - begin,
                          "warnings": [str(w.message) for w in caught], "iterations": model.n_iter_}
                result.update(centroidNpmi=float(np.mean(centroid_coherence)), centroidWords=[[words[j] for j in t] for t in centroid_terms], centroidNonemptyTopics=len(centroid_terms))
                direction_models.append(result)
                fitted[(method, k, seed)] = (terms, test_rep)
                if seed == cfg["seed"]:
                    with warnings.catch_warnings(record=True) as caught_transform:
                        rep = model.transform(input_matrix)
                    result["transformWarnings"] = [str(w.message) for w in caught_transform]
                    representations[f"{method}{k}"] = normalize(rep)
                    # Dominant topic = candidate group, NOT an accepted direction or semantic gold.
                    assignments = rep[pi].argmax(axis=1)
                    candidate_groups = {j: [i for i in range(len(pi)) if assignments[i] == j and input_matrix[pi[i]].nnz] for j in range(k)}
                    niche_results.append(summarize_niches(candidate_groups, features, f"{method}{k}"))
                    result["recentSharesBySource"] = {kind: (np.bincount(rep[[i for i, r in enumerate(rows) if r["kind"] == kind and r["inWindow"] and counts[i].nnz]].argmax(axis=1), minlength=k) / sum(r["kind"] == kind and r["inWindow"] for r in rows)).tolist() for kind in ["paper", "github", "news"]}
                    result["zeroVocabularyBySource"] = {kind: sum(counts[i].nnz == 0 for i, r in enumerate(rows) if r["kind"] == kind and r["inWindow"]) for kind in ["paper", "github", "news"]}
                    result["examples"] = [[{"id": rows[i]["id"], "title": rows[i]["title"], "url": rows[i]["url"]} for i in sorted(test, key=lambda i: -rep[i, j])[:3]] for j in range(k)]
                print(json.dumps({key: result[key] for key in ["method", "k", "seed", "npmi", "diversity", "seconds"]}), flush=True)
    stability_results = []
    for method in ["nmf", "lda"]:
        for k in cfg["topics"]:
            pairs = []
            for s1, s2 in itertools.combinations(cfg["modelSeeds"], 2):
                a, b = fitted[(method, k, s1)], fitted[(method, k, s2)]
                pairs.append({"seeds": [s1, s2], "matchedWordJaccard": stability(a[0], b[0]), "testARI": adjusted_rand_score(a[1].argmax(axis=1), b[1].argmax(axis=1))})
            stability_results.append({"method": method, "k": k, "pairs": pairs})
    # Known-link retrieval: identify links before masking text. No hand/AI labels are loaded.
    by_key = collections.defaultdict(set)
    for i, r in enumerate(rows):
        if r["kind"] != "paper":
            for key in r["keys"]:
                by_key[key].add(i)
    retrieval = {}
    query_records = []
    for kind in ["github", "news"]:
        gallery = sorted([i for i, r in enumerate(rows) if r["kind"] == kind], key=lambda i: rows[i]["id"])
        positions = {idx: j for j, idx in enumerate(gallery)}
        queries = [(i, {positions[j] for key in r["keys"] for j in by_key[key] if j in positions}) for i, r in enumerate(rows) if r["kind"] == "paper" and held[i]]
        queries = [(i, p) for i, p in queries if p]
        if not queries:
            retrieval[kind] = {"queryCount": 0, "gallerySize": len(gallery), "status": "no explicit linked held-out papers; unavailable, not zero accuracy"}
            continue
        gcount = counts[gallery].tocsr().astype(float)
        analyzer = vec.build_analyzer()
        lengths = np.array([len(analyzer(texts[i])) for i in gallery], dtype=float)
        avg = lengths.mean()
        df = np.asarray((gcount > 0).sum(axis=0)).ravel()
        idf = np.log(1 + (len(gallery) - df + .5) / (df + .5))
        k1, b = cfg["bm25"]["k1"], cfg["bm25"]["b"]
        rows_idx = np.repeat(np.arange(len(gallery)), np.diff(gcount.indptr))
        gcount.data = gcount.data * (k1 + 1) / (gcount.data + k1 * (1 - b + b * lengths[rows_idx] / avg)) * idf[gcount.indices]
        methods = {"rules": [], "tfidf": [], "bm25": [], "nmf7": [], "lda7": [], "nmf20": [], "lda20": []}
        query_groups = [component_ids[root(i)] for i, _ in queries]
        strict_methods = {k: [] for k in methods}
        query_ids = []
        for i, positive in queries:
            query_ids.append(rows[i]["id"])
            scores = {"tfidf": (X[gallery] @ X[i].T).toarray().ravel(), "bm25": (gcount @ (counts[i] > 0).T).toarray().ravel()}
            scores.update({name: representations[name][gallery] @ representations[name][i] for name in ["rules", "nmf7", "lda7", "nmf20", "lda20"]})
            # Harder diagnostic: remove repository-title tokens from each paper query, keeping the same positives.
            title_tokens = set(vec.build_analyzer()(" ".join(rows[gallery[j]]["title"] for j in positive)))
            q = counts[i].copy().astype(float)
            q.data[[words[j] in title_tokens for j in q.indices]] = 0
            q.eliminate_zeros()
            strict_scores = {"tfidf": (X[gallery] @ tf.transform(q).T).toarray().ravel(), "bm25": (gcount @ (q > 0).T).toarray().ravel()}
            for name, s in scores.items():
                methods[name].append(metrics(s, positive))
                if name in strict_scores:
                    strict_methods[name].append(metrics(strict_scores[name], positive))
            query_records.append({"id": rows[i]["id"], "title": rows[i]["title"], "url": rows[i]["url"], "kind": kind, "positives": [rows[gallery[j]]["id"] for j in sorted(positive)], "metrics": {m: v[-1] for m, v in methods.items()}})
        retrieval[kind] = {"queryCount": len(queries), "gallerySize": len(gallery), "positiveLinks": sum(len(p) for _, p in queries), "queryIds": query_ids,
                           "metrics": {m: {metric: bootstrap([r[metric] for r in vals], clusters=query_groups) for metric in ["recall10", "hit10", "mrr"]} for m, vals in methods.items()},
                           "titleTokenMask": {m: {metric: bootstrap([r[metric] for r in vals], clusters=query_groups) for metric in ["recall10", "mrr"]} for m, vals in strict_methods.items() if vals},
                           "pairedDeltaVsRules": {m: {metric: bootstrap([r[metric]-base[metric] for r, base in zip(vals, methods["rules"])], clusters=query_groups) for metric in ["recall10", "mrr"]} for m, vals in methods.items() if m != "rules"},
                           "pairedTfidfMinusBm25": {metric: bootstrap([a[metric]-b[metric] for a,b in zip(methods["tfidf"],methods["bm25"])], clusters=query_groups) for metric in ["recall10", "mrr"]},
                           "queryScores": query_records[-len(queries):]}
    # Sensitivity of the EXISTING mainstream decision to source weighting and threshold.
    directions = data["baseline"]["directions"]
    sensitivities = []
    for name, weight in [("equal", [1/3]*3), ("paperHalf", [.5,.25,.25]), ("paperOnly", [1,0,0]), ("noNews", [.5,.5,0])]:
        values = {d["id"]: sum(w * d["shares"][kind] for w, kind in zip(weight, ["paper", "github", "news"])) for d in directions}
        sensitivities.append({"weights": name, "scores": values, "order": sorted(values, key=lambda k: -values[k]), "mainstreamByThreshold": {str(t): [d["id"] for d in directions if values[d["id"]] >= t and d["counts"]["paper"] >= 3 and sum(v >= 2 for v in d["counts"].values()) >= 2] for t in [.03,.05,.07]}})
    result = {"protocol": cfg, "metadata": data["metadata"], "runtime": {"python": platform.python_version(), "numpy": np.__version__, "scipy": scipy.__version__, "sklearn": sklearn.__version__},
              "population": {"allRows": n, "train": len(train), "test": len(test), "vocabulary": len(words), "sourceTrain": dict(collections.Counter(rows[i]["kind"] for i in train)), "sourceTest": dict(collections.Counter(rows[i]["kind"] for i in test)), "components": len(components), "largestComponent": max(map(len, components.values())), "exactTextDuplicates": n-len(unique), "paperYears": dict(collections.Counter(p["date"][:4] for p in features)), "corpusSha256": data["metadata"]["corpusSha256"]},
              "topics": direction_models, "seedStability": stability_results, "retrieval": retrieval, "niches": niche_results, "mainstreamSensitivity": sensitivities,
              "baseline": {k: v for k,v in data["baseline"].items() if k != "niches"}}
    (out / "results.json").write_text(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False)+"\n")
    (out / "split.json").write_text(json.dumps({"trainIds": [rows[i]["id"] for i in train], "testIds": [rows[i]["id"] for i in test], "retrievalQueries": query_records}, ensure_ascii=False, indent=2)+"\n")
    print(json.dumps({"stage": "complete", "output": str(out / "results.json"), "retrievalQueries": {k: v["queryCount"] for k,v in retrieval.items()}, "niches": [{k:v for k,v in s.items() if k != "candidates"} for s in niche_results]}, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    with threadpool_limits(limits=1):
        main()
