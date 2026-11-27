import json
from pathlib import Path
HERE=Path(__file__).resolve().parent
access="auth != null && auth.token.email_verified == true && root.child('spark/access').child(auth.uid).child('enabled').val() == true"
role="root.child('spark/access').child(auth.uid).child('profile').val()"
boss=role+" == 'boss'"
allowed=access+" && ("+boss+" || "+role+" == $profile)"
team_fields=['id','mgr','company','date','shipDate','client','tech','sum','margin','type','status','bonus','reimburse','reimbursed','investorShare','investorPaid','ts']
# No parent write grant: history nodes are create-only even for the owner.
rules={'.read':False,'.write':False,'dashboard':{'.read':False,'.write':False},'dashboard_test':{'.read':False,'.write':False},'data':{'.read':True,'.write':True},'presence':{'.read':True,'.write':True}}
spark={'access':{'$uid':{'.read':access+' && auth.uid == $uid'}},'profiles':{'.read':access+' && '+boss,'$profile':{'.read':allowed}}}
profile=spark['profiles']['$profile']
for kind in ['sales','activity','plans']:
    record={'.validate':"newData.hasChildren(['head','versions'])",'head':{'.write':allowed,'.validate':"newData.isNumber() && newData.val() == (data.exists() ? data.val()+1 : 1) && newData.parent().child('versions').child(newData.val()+'').exists()"}}
    version={'.write':allowed+' && !data.exists()', '.validate':"newData.hasChildren(['at','uid','op','deleted','payload']) && $version == newData.parent().parent().child('head').val()+'' && newData.child('at').val() == now && newData.child('uid').val() == auth.uid && newData.child('op').isString() && newData.child('op').val().length <= 100 && newData.child('deleted').isBoolean() && (newData.child('deleted').val() == false || "+boss+")"}
    version.update({'at':{'.validate':'newData.isNumber()'},'uid':{'.validate':'newData.isString()'},'op':{'.validate':'newData.isString()'},'deleted':{'.validate':'newData.isBoolean()'},'$other':{'.validate':False}})
    payload={'.validate':"newData.child('mgr').val() == $profile" if kind!='plans' else 'true'}
    numeric=['sum','purchase','expense','reimburse','investorShare','bonus','ts','margin'] if kind=='sales' else (['found','book','ads','upd','newc','rep','dial','la','lap','lc'] if kind=='activity' else ['margin','av'])
    text=['id','mgr','company','date','shipDate','client','contactName','contactPhone','tech','expenseDesc','type','status','bonusComm','comm','vin','stockNo','lastContact','nextCall'] if kind=='sales' else (['mgr','date','comm'] if kind=='activity' else [])
    for f in numeric:payload[f]={'.validate':'newData.isNumber()'+('' if f=='margin' and kind=='sales' else ' && newData.val() >= 0')}
    for f in text:payload[f]={'.validate':"newData.isString() && newData.val().length <= 10000 && !newData.val().contains('<') && !newData.val().contains('>')"}
    if kind=='sales':
        payload['.validate']+=" && newData.hasChildren(['id','mgr','sum','margin','type','status']) && newData.child('id').val() == $id && (newData.child('type').val() == 'АВ' || newData.child('vin').val() != null && newData.child('vin').val() != '' || newData.child('stockNo').val() != null && newData.child('stockNo').val() != '')"
        payload['reimbursed']={'.validate':'newData.isBoolean()'}
        payload['investorPaid']={'.validate':'newData.isBoolean()'}
        payload['type']['.validate']="newData.val() == 'АВ' || newData.val() == 'Безнал' || newData.val() == 'Лизинг' || newData.val() == 'Наличные'"
        payload['status']['.validate']="newData.val() == 'Закрыта' || newData.val() == 'В работе' || newData.val() == 'Аванс получен' || newData.val() == 'Отменена'"
        for f,pattern in [('vin','[A-HJ-NPR-Z0-9]{17}'),('stockNo','[A-Z0-9_-]{1,80}')]:
            payload[f]['.validate']="newData.val() == '' || newData.isString() && newData.val().matches(/^"+pattern+"$/)"
            # Registry reserves an identifier for its original record. AV can reuse it.
            payload['.validate']+=" && (newData.parent().child('deleted').val() == true || newData.child('type').val() == 'АВ' || !newData.child('"+f+"').exists() || newData.child('"+f+"').val() == '' || newData.parent().parent().parent().parent().parent().parent().parent().child('claims/"+f+"').child(newData.child('"+f+"').val()).child('profile').val() == $profile && newData.parent().parent().parent().parent().parent().parent().parent().child('claims/"+f+"').child(newData.child('"+f+"').val()).child('id').val() == $id)"
    if kind=='activity':payload['.validate']+=" && newData.hasChildren(['mgr','date','found','book','ads','upd','newc','rep']) && newData.child('date').val() == $id"
    if kind=='plans':
        record['head']['.write']=access+' && '+boss
        version['.write']=access+' && '+boss+' && !data.exists()'
        payload['.validate']="newData.hasChildren(['margin','av'])"
    payload['$other']={'.validate':False}
    if kind in ['sales','plans']:
        fields=team_fields if kind=='sales' else ['margin','av']
        top="newData"+".parent()"*6
        shared=top+".child('teamView/"+kind+"').child($profile).child($id)"
        matches=" && ".join(shared+".child('"+field+"').val() == newData.child('payload/"+field+"').val()" for field in fields)
        version['.validate']+=" && ("+top+".child('teamView/enabled').val() != true || (newData.child('deleted').val() == true ? !"+shared+".exists() : "+shared+".exists() && "+matches+"))"
    version['payload']=payload
    record['versions']={'$version':version}
    record['$other']={'.validate':False}
    profile[kind]={'$id':record}
# Owner sees all versions; manager sees only their profile. Access records are provisioned by Admin SDK.
claims={'.read':access}
for field in ['vin','stockNo']:
    target="newData.parent().parent().parent().child('profiles').child(newData.child('profile').val()).child('sales').child(newData.child('id').val())"
    current=target+".child('versions').child("+target+".child('head').val()+'').child('payload')"
    claims[field]={'$key':{'.write':access+' && !data.exists()', '.validate':"newData.hasChildren(['profile','id']) && ("+boss+" || newData.child('profile').val() == "+role+") && "+current+".child('"+field+"').val() == $key",'profile':{'.validate':'newData.isString()'},'id':{'.validate':'newData.isString()'},'$other':{'.validate':False}}}

team={'.read':access,'enabled':{'.write':False}}
for kind in ['sales','plans']:
    fields=team_fields if kind=='sales' else ['margin','av']
    top="newData"+".parent()"*4
    private=top+".child('profiles').child($profile).child('"+kind+"').child($id)"
    latest=private+".child('versions').child("+private+".child('head').val()+'')"
    canwrite=allowed if kind=='sales' else access+' && '+boss
    row={'.write':canwrite+" && (newData.exists() || "+latest+".child('deleted').val() == true)",'.validate':latest+".exists() && "+latest+".child('deleted').val() == false"}
    for field in fields:row['.validate']+=" && newData.child('"+field+"').val() == "+latest+".child('payload/"+field+"').val()"
    row.update({field:{'.validate':True}for field in fields})
    row['$other']={'.validate':False}
    team[kind]={'$profile':{'$id':row}}
spark['teamView']=team
spark['claims']=claims
rules['spark']=spark
(HERE/'database.rules.json').write_text(json.dumps({'rules':rules},ensure_ascii=False,indent=2)+'\n')
