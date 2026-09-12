"""Run with python3 research/vt-comparison/baker-test.py (Pillow + NumPy)."""
import importlib.util
from pathlib import Path
import tempfile
import unittest
import sys
import numpy as np
from PIL import Image

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('baker', Path(__file__).resolve().parents[2] / 'scripts/bake-vt-pages.py')
baker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(baker)


class BakerTest(unittest.TestCase):
    def test_linear_light_and_transparent_edges(self):
        pixels = baker.linear_pixels(Image.fromarray(np.array([[[0, 0, 0, 255], [255, 255, 255, 255]]], dtype=np.uint8)))
        np.testing.assert_array_equal(baker.srgb_pixels(pixels.mean(axis=1, keepdims=True)), [[[188, 188, 188, 255]]])
        pixels = baker.linear_pixels(Image.fromarray(np.array([[[255, 0, 0, 255], [0, 0, 255, 0]]], dtype=np.uint8)))
        np.testing.assert_array_equal(baker.srgb_pixels(pixels.mean(axis=1, keepdims=True)), [[[255, 0, 0, 128]]])

    def test_gutters_match_neighbors_and_wrap(self):
        pixels = np.arange(256 * 256 * 4).reshape(256, 256, 4)
        left = baker.padded_page(pixels, 0, 0, 128, 2, 'clamp-to-edge')
        right = baker.padded_page(pixels, 1, 0, 128, 2, 'clamp-to-edge')
        np.testing.assert_array_equal(left[:, 128:132], right[:, :4])
        wrapped = baker.padded_page(pixels, 0, 0, 128, 2, 'repeat')
        np.testing.assert_array_equal(wrapped[0, 0], pixels[-2, -2])

    def test_complete_tree_and_existing_destination(self):
        with tempfile.TemporaryDirectory() as directory:
            source, output = Path(directory) / 'input.png', Path(directory) / 'pages'
            Image.new('RGBA', (512, 256), (255, 0, 0, 255)).save(source)
            result = baker.bake(source, output)
            self.assertEqual(result['pages'], 11)
            self.assertEqual(result['mipCount'], 3)
            self.assertTrue((output / 'manifest.json').exists())
            with self.assertRaises(FileExistsError):
                baker.bake(source, output)

    def test_malformed_astc_rejected(self):
        with self.assertRaises(ValueError):
            baker.astc_ktx2(bytes(32), 132, 6)


if __name__ == '__main__':
    unittest.main()
