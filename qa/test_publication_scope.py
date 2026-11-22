"""Accept the same publication with and without its 1C locale suffix."""
from argparse import Namespace
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'app'))
from visual_mcp import WebClient


class PublicationScope(unittest.TestCase):
    def test_explicit_port(self):
        with self.assertRaises(ValueError):
            WebClient(Namespace(url='http://localhost:0/team/erp'))
        self.assertEqual(WebClient(Namespace(url='http://localhost:18194/team/erp')).origin,
                         ('http','localhost:18194'))

    def test_configured_publication(self):
        for suffix in ('erp', 'erp/', 'erp/ru_RU/', 'erp/en_US'):
            with self.subTest(suffix=suffix):
                client = WebClient(Namespace(url='http://localhost/team/'+suffix))
                self.assertEqual(client.path, '/team/erp/')
                client.tab = Namespace(url='http://localhost/team/erp/en_US/',is_closed=lambda: False)
                self.assertIs(client.page(),client.tab)
                client.tab.url = 'http://localhost/team/other/'
                with self.assertRaises(ValueError):
                    client.page()


if __name__=='__main__':
    unittest.main()
