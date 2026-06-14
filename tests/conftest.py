import sys
import pathlib

# Make the repo root importable so `program_scoring` and other root-level modules
# can be imported in tests without installing the package.
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
