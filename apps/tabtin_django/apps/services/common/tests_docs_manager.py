from pathlib import Path
from tempfile import TemporaryDirectory

from django.test import SimpleTestCase

from .docs_manager import APIDocsManager


class APIDocsManagerFreshCloneTests(SimpleTestCase):
    def test_missing_optional_docs_directory_is_read_only_and_empty(self):
        with TemporaryDirectory() as root:
            docs_dir = Path(root) / "fresh-clone" / "docs" / "api"

            manager = APIDocsManager(docs_dir=docs_dir)

            self.assertEqual(manager.get_available_docs(), [])
            self.assertFalse(docs_dir.exists())
