import json,statistics,random,sys,math
file=sys.argv[1];d=json.load(open(file));s=d['samples'];candidate=next(x['variant'] for x in s if x['variant']!='baseline');out=[]
for profile in ['normal','latency']:
 for scenario in ['card','dracoMain','dracoWorker']:
  for cache in ['cold','warm']:
   records={v:{x['rep']:x for x in s if x['profile']==profile and x['scenario']==scenario and x['cache']==cache and x['variant']==v} for v in ['baseline',candidate]}
   pairs=sorted(set(records['baseline'])&set(records[candidate]));
   if not pairs:continue
   a=[records['baseline'][i]['settledAt'] for i in pairs];b=[records[candidate][i]['settledAt'] for i in pairs];delta=[y-x for x,y in zip(a,b)];rng=random.Random(42)
   boot=sorted(statistics.mean(rng.choices(delta,k=len(delta))) for _ in range(5000))
   q=lambda x,p:sorted(x)[max(0,math.ceil(len(x)*p)-1)]
   row={'profile':profile,'scenario':scenario,'cache':cache,'pairs':len(pairs),'baselineMedian':statistics.median(a),'candidateMedian':statistics.median(b),'pairedMedianDelta':statistics.median(delta),'pairedMeanDelta':statistics.mean(delta),'meanDelta95BootstrapCI':[boot[124],boot[4874]],'baselineP95':q(a,.95),'candidateP95':q(b,.95),'baselineLongTaskMsMedian':statistics.median(sum(t['duration'] for t in records['baseline'][i]['longTasks']) for i in pairs),'candidateLongTaskMsMedian':statistics.median(sum(t['duration'] for t in records[candidate][i]['longTasks']) for i in pairs)}
   out.append(row)
   print(profile,scenario,cache,len(pairs),'median',round(row['baselineMedian'],1),'->',round(row['candidateMedian'],1),'paired',round(row['pairedMedianDelta'],1),'CImean',*[round(x,1) for x in row['meanDelta95BootstrapCI']])
json.dump({'metadata':d['metadata'],'summary':out},open(file.replace('.json','-summary.json'),'w'),indent=2)
