from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from check_pages_tree import (
    check_pages_tree,
    main,
    measure_pages_tree,
    parse_blob_sizes,
    parse_index,
)


class PagesTreeBudgetTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        subprocess.run(["git", "init", "-q", str(self.root)], check=True)

    def git(self, *arguments, data=None):
        return subprocess.check_output(
            ["git", "-C", str(self.root), *arguments],
            input=data,
            stderr=subprocess.PIPE,
        )

    def add(self, path, body):
        file = self.root / path
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_bytes(body)
        self.git("add", "--", path)

    def test_exact_boundary_counts_source_archives_and_each_duplicate_path(self):
        self.add("research-monitor/index.html", b"123")
        self.add("tools/research-monitor/data/records.json", b"123")
        self.add("name with spaces.txt", b"45")
        self.assertEqual(check_pages_tree(self.root, 8).bytes, 8)
        self.assertEqual(check_pages_tree(self.root, 8).files, 3)
        with self.assertRaisesRegex(ValueError, "exceeding the 7-byte limit"):
            check_pages_tree(self.root, 7)
        with patch("sys.stderr"):
            self.assertEqual(main(["--repo-root", str(self.root), "--max-bytes", "7"]), 1)

    def test_index_replacement_ignores_unstaged_files_and_untracked_dependencies(self):
        self.add(".gitignore", b"node_modules/\ndist/\n")
        self.add("research-monitor/index.html", b"old")
        self.add("research-monitor/obsolete.txt", b"old orphan")
        self.git("rm", "--cached", "--", "research-monitor/obsolete.txt")
        self.add("research-monitor/index.html", b"new publication")
        (self.root / "research-monitor/index.html").write_bytes(b"unstaged replacement")
        for name in ["node_modules/package/index.js", "dist/index.html", "untracked.txt"]:
            file = self.root / name
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_bytes(b"x" * 1000)
        expected = len(b"node_modules/\ndist/\n") + len(b"new publication")
        self.assertEqual(measure_pages_tree(self.root).bytes, expected)
        self.assertEqual(measure_pages_tree(self.root).files, 2)

    def test_repository_subdirectory_still_counts_the_complete_root(self):
        self.add("research-monitor/index.html", b"123")
        self.add("tools/research-monitor/data/records.json", b"4567")
        self.assertEqual(measure_pages_tree(self.root / "research-monitor").bytes, 7)
        self.assertEqual(measure_pages_tree(self.root / "tools/research-monitor").files, 2)

    def test_symlink_and_unmerged_or_unsafe_index_entries_fail(self):
        target = self.root / "outside-target"
        target.write_bytes(b"not followed")
        (self.root / "link").symlink_to(target)
        self.git("add", "--", "link")
        with self.assertRaisesRegex(ValueError, "symlink"):
            measure_pages_tree(self.root)
        digest = b"a" * 40
        for row in [
            b"100644 " + digest + b" 1\tconflicted\0",
            b"160000 " + digest + b" 0\tsubmodule\0",
            b"100644 " + digest + b" 0\t../outside\0",
            b"100644 " + digest + b" 0\t.git/config\0",
            b"100644 " + digest + b" 0\t/absolute\0",
            b"100644 " + digest + b" 0\ta\\b\0",
            b"100644 " + digest + b" 0\ta\0" + b"100644 " + digest + b" 0\ta\0",
            b"100644 " + digest + b" 0\tmissing-terminator",
        ]:
            with self.subTest(row=row), self.assertRaises(ValueError):
                parse_index(row)

    def test_missing_object_is_not_silently_counted_as_zero(self):
        self.git("update-index", "--add", "--cacheinfo", "100644," + "a" * 40 + ",missing.txt")
        with self.assertRaisesRegex(ValueError, "missing"):
            measure_pages_tree(self.root)
        with patch("sys.stderr"):
            self.assertEqual(main(["--repo-root", str(self.root)]), 1)

    def test_unknown_or_incomplete_object_responses_fail(self):
        digest = b"a" * 40
        for response in [
            b"",
            digest + b" missing\n",
            digest + b" tree 10\n",
            digest + b" blob NaN\n",
            digest + b" blob -1\n",
            b"b" * 40 + b" blob 10\n",
            digest + b" blob 10\n" + digest + b" blob 10\n",
        ]:
            with self.subTest(response=response), self.assertRaises(ValueError):
                parse_blob_sizes(response, [digest])

    def test_git_failure_and_empty_index_fail_closed(self):
        with self.assertRaisesRegex(ValueError, "empty"):
            measure_pages_tree(self.root)
        with patch("check_pages_tree.git_output", side_effect=subprocess.TimeoutExpired("git", 60)):
            with patch("sys.stderr"):
                self.assertEqual(main(["--repo-root", str(self.root)]), 1)
        with self.assertRaises(ValueError):
            check_pages_tree(self.root, -1)


if __name__ == "__main__":
    unittest.main()
