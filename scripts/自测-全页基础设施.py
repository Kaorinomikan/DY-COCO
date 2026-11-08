"""公共组件覆盖闸门：新增业务页面、漏组件、重复兜底与主世界隔离。"""
import copy
import json
from pathlib import Path
import unittest
from page_infrastructure import BASE_JS, check_infrastructure, fallback_entry, is_fallback

ROOT = Path(__file__).resolve().parents[1]


class CoverageTests(unittest.TestCase):
    def setUp(self):
        self.manifest = json.loads((ROOT / 'manifest.json').read_text(encoding='utf-8'))

    def refresh(self):
        entries = self.manifest['content_scripts']
        entries[:] = [c for c in entries if not is_fallback(c)] + [fallback_entry(self.manifest)]

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

    def test_partial_bundle_is_rejected(self):
        entry = next(c for c in self.manifest['content_scripts'] if 'src/content/campaign-channel-tick.js' in c.get('js', []))
        entry['js'].remove('src/content/debug-panel.js')
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
