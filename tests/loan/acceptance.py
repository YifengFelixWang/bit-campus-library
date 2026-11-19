"""HTTP acceptance against D's disposable seed database; requires identity_stub."""
import concurrent.futures
import json
import os
import urllib.request
import urllib.error
import urllib.parse
import uuid
BASE = os.environ.get('LOAN_API', 'http://localhost:8083/api')
def call(path, token='demo-reader-1', body=None, method=None):
    req = urllib.request.Request(BASE + path, data=None if body is None else json.dumps(body).encode(),
        method=method, headers={'Authorization': 'Bearer '+token, 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, json.load(r)
    except urllib.error.HTTPError as e:
        return e.code, json.load(e)
def key(): return str(uuid.uuid4())
def run():
    assert call('/loans','invalid')[0] == 401
    assert call('/loans?all=true')[0] == 403
    for token,name in [('demo-reader-1','db_loan_reader01'),('demo-reader-2','db_loan_reader02'),('demo-librarian','db_loan_librarian01'),('demo-reader-1','db_loan_reader01')]:
        status,me=call('/me',token)
        assert status==200 and me['database']['current_user']==name and me['database']['session_user']==name,(status,me)
    assert call('/loans',body={'readerId':2,'copyId':2,'days':14,'requestKey':key()})[0]==403
    status,copy=call('/copies','demo-librarian',{'bookId':1,'barcode':'TEST-'+key()})
    assert status==200,(status,copy)
    payloads=[{'readerId':1,'copyId':copy['copy_id'],'days':14,'requestKey':key()} for _ in range(20)]
    with concurrent.futures.ThreadPoolExecutor(max_workers=20) as pool:
        results=list(pool.map(lambda p:call('/loans',body=p),payloads))
    winners=[i for i,r in enumerate(results) if r[0]==200]
    assert len(winners)==1 and all(r[0] in (200,409) for r in results),results
    i=winners[0];loan=results[i][1];loan_id=loan['loan_id']
    try:
        assert call('/loans',body=payloads[i])[1]['loan_id']==loan_id
        assert call('/loans',body={**payloads[i],'days':15})[0]==409
        assert all(r['user_id']==2 for r in call('/loans','demo-reader-2')[1])
        path='/loans/'+str(loan_id)+'/return'
        assert call(path,'demo-reader-2',{'requestKey':key()})[0]==403
        request={'requestKey':key()}
        first=call(path,body=request);second=call(path,body=request)
        assert first[0]==second[0]==200
        assert first[1]['returned_at']==second[1]['returned_at']
        assert call(path,'demo-librarian',{'requestKey':key()})[1]['returned_at']==first[1]['returned_at']
        assert call('/internal/loans/changes')[0]==403
        cursor={};found=False;seen=set()
        for _ in range(100):
            status,page=call('/internal/loans/changes?limit=2&'+urllib.parse.urlencode(cursor),'demo-sync')
            assert status==200,(status,page)
            for r in page['items']:
                assert 'deleted' in r and 'updated_at' in r
                assert r['loan_id'] not in seen
                seen.add(r['loan_id']);found=found or r['loan_id']==loan_id
            cursor=page['nextCursor']
            if not page['hasMore']:break
        assert found
        print(json.dumps({'status':'PASS','concurrent_requests':20,'successful_borrows':1,'loan_id':loan_id,'identity_pools':3,'sync_cursor':'PASS'}))
    finally:
        call('/loans/'+str(loan_id)+'/return','demo-librarian',{'requestKey':key()})
if __name__=='__main__': run()

