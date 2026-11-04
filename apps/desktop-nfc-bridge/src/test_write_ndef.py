import unittest
from write_ndef import ndef_uri, parse_ndef_uri, validate_capacity


class NdefWriterTests(unittest.TestCase):
    def test_uri_round_trip(self):
        for url in ("https://example.com/c/abc", "https://example.com/বাংলা"):
            self.assertEqual(parse_ndef_uri(ndef_uri(url)), url)

    def test_rejects_oversized_and_truncated_messages(self):
        with self.assertRaises(ValueError):
            ndef_uri("https://example.com/" + "x" * 250)
        with self.assertRaises(ValueError):
            parse_ndef_uri(ndef_uri("https://example.com")[:8])

    def test_checks_type_capacity_and_access_before_writing(self):
        validate_capacity(bytes([0xE1, 0x10, 18, 0]), 144)
        for capability, size in ((bytes([0, 0, 0, 0]), 4), (bytes([0xE1, 0x10, 18, 0]), 148),
                                 (bytes([0xE1, 0x10, 18, 0x0F]), 4)):
            with self.assertRaises(ValueError):
                validate_capacity(capability, size)


if __name__ == "__main__":
    unittest.main()
