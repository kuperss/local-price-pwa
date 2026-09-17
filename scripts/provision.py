"""Create only this app's D1 and path-scoped Access application; rerunnable."""
import json
from cloud import Cloud, ROOT

NAME='local-price-managed'
ADMIN='jerryloveyoux@gmail.com'

def main():
    c=Cloud()
    dbs=c.api('d1/database?per_page=100')
    db=next((d for d in dbs if d['name']==NAME),None)
    if not db: db=c.api('d1/database','POST',{'name':NAME})
    dbid=db['uuid']
    for sql in (ROOT/'worker/schema.sql').read_text(encoding='utf-8').split(';'):
        if sql.strip():c.query(dbid,sql)
    from catalog_sync import setup
    setup(c,dbid)
    subdomain=c.api('workers/subdomain')['subdomain']
    hostname=f'{NAME}.{subdomain}.workers.dev'
    # Existing account's Access domain, verified from mobile-query's login redirect.
    team='https://kupers.cloudflareaccess.com'
    apps=c.api('access/apps?per_page=100')
    app=next((a for a in apps if a['name']=='售價速查管理後台'),None)
    if not app:
        app=c.api('access/apps','POST',{'name':'售價速查管理後台','domain':hostname+'/admin','type':'self_hosted','session_duration':'12h','app_launcher_visible':False,
              'policies':[{'name':'Owner only','decision':'allow','include':[{'email':{'email':ADMIN}}]}]})
    cfg={'database_id':dbid,'worker':NAME,'url':'https://'+hostname,'access_aud':app['aud'],'access_team':team,'access_app_id':app['id'],'admin_email':ADMIN}
    (ROOT/'deployment.local.json').write_text(json.dumps(cfg,ensure_ascii=False,indent=2),encoding='utf-8')
    wrangler={'name':NAME,'main':'worker/index.js','compatibility_date':'2026-09-01','workers_dev':True,'preview_urls':False,
              'assets':{'directory':'./dist','binding':'ASSETS','run_worker_first':True},
              'd1_databases':[{'binding':'DB','database_name':NAME,'database_id':dbid}],
              'vars':{'ADMIN_EMAIL':ADMIN,'ACCESS_TEAM':team,'ACCESS_AUD':app['aud']}}
    (ROOT/'wrangler.jsonc').write_text(json.dumps(wrangler,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({'url':cfg['url'],'admin':cfg['url']+'/admin/','database_ready':True,'access_ready':True},ensure_ascii=False))

if __name__=='__main__':main()
