import tempfile
from pathlib import Path
import unittest
import pandas as pd

from wrangle_grants import load_folder, main


class LoadFolderTests(unittest.TestCase):
    def test_skip_empty_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            # Non-empty CSV
            pd.DataFrame({'a': [1]}).to_csv(tmp_path / 'non_empty.csv', index=False)
            # Empty CSV
            pd.DataFrame({'a': []}).to_csv(tmp_path / 'empty.csv', index=False)

            frames = load_folder(tmp_path)
            self.assertEqual(len(frames), 1)
            self.assertIn('_source_file', frames[0].columns)
            self.assertTrue(frames[0]['_source_file'].iloc[0].endswith('non_empty.csv'))


class MainTests(unittest.TestCase):
    def test_main_writes_output(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            in_dir = tmp_path / 'in'
            in_dir.mkdir()
            pd.DataFrame({
                'Grant name': ['Test Grant'],
                'Sponsor org': ['Org'],
                'Link': ['http://example.com'],
                'Deadline': ['2030-01-01']
            }).to_csv(in_dir / 'g.csv', index=False)
            out_file = tmp_path / 'out.csv'

            main(['--input', str(in_dir), '--out', str(out_file)])

            self.assertTrue(out_file.exists())
            df = pd.read_csv(out_file)
            self.assertEqual(len(df), 1)


if __name__ == '__main__':
    unittest.main()
