"""发布真实入口的离线请求量回归：不读取凭据、不访问网络。"""
import contextlib
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('publisher', ROOT / 'scripts/publish-github-api.py')
pub = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pub)


class PublishSpeedTests(unittest.TestCase):
    def run_publish(self, *, existing_tag=False, remote=True, tree_error=False, truncated=False):
        contents = {str(i): ('file-%d' % i).encode() for i in range(100)}
        contents['99'] = b'\x00\xffbinary\r\n'
        blobs = {k: hashlib.sha1(b'blob %d\0' % len(v) + v).hexdigest()
                 for k, v in contents.items()}
        by_sha = {blobs[k]: v for k, v in contents.items()}
        files = [('file-%s' % k, '100644', sha) for k, sha in blobs.items()]
        # 同内容改名、重复路径内容、执行位，以及远端多出的已删除文件。
        files[0] = ('renamed', '100755', blobs['0'])
        files.append(('duplicate', '100644', blobs['0']))
        remote_tree = [{'path': 'file-%d' % i, 'type': 'blob', 'sha': blobs[str(i)]}
                       for i in range(99)]
        remote_tree.append({'path': 'deleted', 'type': 'blob', 'sha': 'd' * 40})
        remote_tree.append({'path': 'file-99', 'type': 'blob', 'sha': 'e' * 40})
        requests = []
        gh = pub.GitHub('', 'offline', 'test')

        def request(method, url, body=None):
            requests.append((method, url, body))
            if method == 'GET' and '/git/commits/' in url:
                return {'tree': {'sha': 'remote-tree'}}
            if method == 'GET' and '/git/trees/' in url:
                if tree_error:
                    raise RuntimeError('offline tree failure')
                return {'tree': remote_tree, 'truncated': truncated}
            if url.endswith('/git/blobs'):
                import base64
                content = base64.b64decode(body['content'])
                return {'sha': hashlib.sha1(b'blob %d\0' % len(content) + content).hexdigest()}
            if url.endswith('/git/trees'):
                return {'sha': 'new-tree'}
            raise AssertionError((method, url))

        def git(args, **kwargs):
            return 0, ('local' if args[0] == 'rev-parse' else
                       '1' if args[0] == 'rev-list' else ''), ''

        ROOT.joinpath('.tmp').mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(dir=ROOT / '.tmp') as folder:
            Path(folder, 'update-manifest.json').write_text(
                json.dumps({'files': [{'path': 'src/test.js'}]}), encoding='utf-8')
            with contextlib.ExitStack() as stack:
                mocks = {
                    'REPO_ROOT': folder, 'run_main_preflight': lambda: True,
                    'load_token': lambda: 'offline-token', 'git': git,
                    'commit_chain': lambda n: [{'sha': 'local', 'parents': []}],
                    'all_files_at': lambda sha: files,
                    'read_commit_meta': lambda sha: {'message': 'test', 'author': {}},
                    'GitHub': lambda *args: gh,
                }
                for name, value in mocks.items():
                    stack.enter_context(patch.object(pub, name, value))
                reads = stack.enter_context(patch.object(pub, 'blob_content', side_effect=lambda sha: by_sha[sha]))
                stack.enter_context(patch.object(gh, '_req', side_effect=request))
                stack.enter_context(patch.object(gh, 'repo_info', return_value={'description': 'test', 'topics': ['test']}))
                stack.enter_context(patch.object(gh, 'get_ref', side_effect=['remote' if remote else None, 'new-commit']))
                stack.enter_context(patch.object(gh, 'list_tags', side_effect=[['v1'] if existing_tag else [], ['v1']]))
                stack.enter_context(patch.object(gh, 'create_commit', return_value='new-commit'))
                stack.enter_context(patch.object(gh, 'update_ref'))
                stack.enter_context(patch.object(gh, 'create_ref'))
                network = stack.enter_context(patch.object(pub.urllib.request, 'urlopen'))
                network.return_value.read.return_value = b''
                stack.enter_context(patch.object(pub.sys, 'argv', ['publish', '--owner', 'offline', '--repo', 'test', '--single', '--skip-tags', '--tag', 'v1']))
                stack.enter_context(contextlib.redirect_stdout(io.StringIO()))
                self.assertEqual(pub.main(), 0)
        uploads = [r for r in requests if r[1].endswith('/git/blobs')]
        self.assertEqual(reads.call_count, len(uploads), '复用对象不应逐文件启动 git cat-file')
        tree = next(r[2] for r in requests if r[0] == 'POST' and r[1].endswith('/git/trees'))
        self.assertEqual(tree, {'tree': [{'path': p, 'mode': m, 'type': 'blob', 'sha': s} for p, m, s in files]})
        return len(uploads), network.call_count

    def test_reuses_unchanged_blobs_and_keeps_complete_snapshot(self):
        uploads, _ = self.run_publish()
        print('100 unique blobs, 1 changed: uploads=%d' % uploads)
        self.assertEqual(uploads, 1)

    def test_fresh_tag_does_not_purge_uncached_files(self):
        _, purge = self.run_publish()
        self.assertEqual(purge, 0)

    def test_existing_tag_still_purges(self):
        _, purge = self.run_publish(existing_tag=True)
        self.assertEqual(purge, 1)

    def test_empty_remote_uploads_all_blobs(self):
        uploads, _ = self.run_publish(remote=False)
        self.assertEqual(uploads, 100)

    def test_tree_failure_falls_back_to_complete_upload(self):
        uploads, _ = self.run_publish(tree_error=True)
        self.assertEqual(uploads, 100)

    def test_truncated_tree_only_reuses_confirmed_blobs(self):
        uploads, _ = self.run_publish(truncated=True)
        self.assertEqual(uploads, 1)


if __name__ == '__main__':
    unittest.main()
