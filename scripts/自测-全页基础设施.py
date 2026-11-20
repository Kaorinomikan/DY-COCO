"""公共组件覆盖闸门：新增业务页面、漏组件、重复兜底与主世界隔离。"""
import copy
import json
from pathlib import Path
import unittest
from page_infrastructure import (
    BASE_JS, DEBUG_PANEL, NET_PROBE, NET_PROBE_MAIN,
    check_infrastructure, fallback_entry, fix_infrastructure,
)

ROOT = Path(__file__).resolve().parents[1]


class CoverageTests(unittest.TestCase):
    def setUp(self):
        self.manifest = json.loads((ROOT / 'manifest.json').read_text(encoding='utf-8'))

    def refresh(self):
        fix_infrastructure(self.manifest)

    def test_current_pages(self):
        self.assertEqual(check_infrastructure(self.manifest), [])

    def test_new_page_inherits_baseline(self):
        new = {'matches': ['https://new.example.com/new/page*'], 'js': ['src/content/flags.js', 'feature.js']}
        self.manifest['content_scripts'].append(new)
        self.assertTrue(check_infrastructure(self.manifest), '新页面未同步兜底时必须拦截')
        self.refresh()
        self.assertEqual(check_infrastructure(self.manifest), [])
        baseline = self.manifest['content_scripts'][-1]
        self.assertIn(new['matches'][0], baseline['matches'])
        self.assertNotIn(new['matches'][0], baseline['exclude_matches'])
        self.assertIn(NET_PROBE, baseline['js'])
        resource = next(r for r in self.manifest['web_accessible_resources'] if NET_PROBE_MAIN in r['resources'])
        self.assertIn('https://new.example.com/*', resource['matches'])

    def test_independent_debug_group_inherits_probe(self):
        entry = next(c for c in self.manifest['content_scripts'] if 'src/content/campaign-channel-tick.js' in c.get('js', []))
        entry['js'].remove(NET_PROBE)
        self.assertTrue(check_infrastructure(self.manifest))
        entry['js'].append(NET_PROBE)
        self.assertTrue(check_infrastructure(self.manifest))
        self.refresh()
        self.assertEqual(check_infrastructure(self.manifest), [])
        self.assertLess(entry['js'].index(NET_PROBE), entry['js'].index(DEBUG_PANEL))

    def test_partial_bundle_is_rejected(self):
        entry = next(c for c in self.manifest['content_scripts'] if 'src/content/campaign-channel-tick.js' in c.get('js', []))
        entry['js'].remove(DEBUG_PANEL)
        self.assertTrue(check_infrastructure(self.manifest))

    def test_complete_bundle_is_excluded_from_fallback(self):
        baseline = fallback_entry(self.manifest)
        for c in self.manifest['content_scripts']:
            if c['js'] != BASE_JS and set(BASE_JS).issubset(c['js']):
                self.assertTrue(set(c['matches']).issubset(baseline['exclude_matches']))

    def test_main_world_does_not_receive_isolated_components(self):
        self.manifest['content_scripts'].append({'world': 'MAIN', 'matches': ['https://main.example.com/*'], 'js': ['bridge.js']})
        self.assertEqual(check_infrastructure(self.manifest), [])
        self.assertNotIn('https://main.example.com/*', fallback_entry(self.manifest)['matches'])

    def test_duplicate_fallback_is_rejected(self):
        self.manifest['content_scripts'].append(copy.deepcopy(self.manifest['content_scripts'][-1]))
        self.assertTrue(check_infrastructure(self.manifest))

    def test_missing_message_style_is_rejected(self):
        self.manifest['content_scripts'][-1]['css'].remove('src/content/msgbox.css')
        self.assertTrue(check_infrastructure(self.manifest))


if __name__ == '__main__':
    unittest.main()
