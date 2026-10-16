"""Opt-in paid model checks; no deployment reads or changes."""
import os,subprocess,sys,getpass
from pathlib import Path
root=Path(__file__).resolve().parent.parent
env=os.environ.copy()
if not env.get('OPENAI_API_KEY'):env['OPENAI_API_KEY']=getpass.getpass('OpenAI test key (hidden): ').strip()
if not env['OPENAI_API_KEY']:sys.exit('No test key supplied; nothing run.')
env['INTUNE_ACTUAL_MODEL_EVAL']='1'
(root/'output').mkdir(exist_ok=True)
with (root/'output/actual-model-run.log').open('w') as log:
 result=subprocess.run(['npx','vitest','run','tests/conversation-actual-model.test.ts','--no-file-parallelism'],cwd=root,env=env,stdout=log,stderr=subprocess.STDOUT)
print('Actual-model evaluation exit:',result.returncode)
sys.exit(result.returncode)
