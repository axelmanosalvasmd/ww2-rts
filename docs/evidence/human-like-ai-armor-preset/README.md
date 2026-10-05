# Armor pressure native preset evidence

This package retains the three complete 30-second native preset JSON reports and their HTML reports, the exact reviewed patch, the original and adopted tool/test source, cue declarations and all three recorded test logs. The preset is adopted in ROOT. These authored scenes are immediate gameplay diagnostics, not population acceptance or performance measurements.

The medium initially holds fire. At tick 240 a labeled opponent cue issues its native holdFire stance command. Native projectile simulation first deals 35 HP damage at tick 244. The rifles retain ordinary automatic fire and native cooldown defaults. The first completed physical selection and accepted retreat ticks are Easy 268/272, Normal 259/262 and Hard 252/255. Complete input starts, motors, commands, events and public frames remain in each native report.

The final agent test and adopted ROOT test use the same test SHA e6677a2b4d12c6c89af06b8392052dee02cd8214ed8736c98381f117b69b1288. Their recorded elapsed values are 3126.5 ms and 1741.4 ms respectively. The earlier 3030.0 ms development run used a8030fdfc77371bd29c266f166ed2090b556b08d22a8ecf299c43b1a9ca41444 before the browser parity assertion was added. Its exact reconstructed source and log are retained separately. The pre-adoption test SHA is 73faed730317f8010a504f6e363692931708ff3d78d197cfc61c152bc879368f. No elapsed result is selected as gate evidence.

source-binding.json records native runtime hashes independently of the four adopted tool files. source-before contains exact files reconstructed by reversing integration.patch, checked against their original recorded hashes. source-adopted contains the exact reviewed files checked against ROOT at packaging time. The package avoids another whole-source copy. reviewed/README.md is the historical proposal and remains unchanged.

To reproduce on the adopted source:

```sh
node tools/ai-lab.mjs --serve
node tools/ai-lab.mjs --scenario armor-pressure --level hard --seed 1 --seconds 30 --out /tmp/ai-armor-pressure
```

In the browser, open http://127.0.0.1:3048/tools/ai-lab.html, select armor-pressure, choose seed 1 and a difficulty, then advance 30 simulated seconds. CLI scenes allow 1 through 60 simulated seconds. Interactive scenes allow up to 600 seconds and 48 authored units. The cue is tool-owned opponent scheduling, not an AI physical input or fabricated hurt event.

payload-manifest.json binds every retained member except itself. original-manifest.json maps copied files to their original absolute paths and verifies each exact byte count and SHA256. verification.json outside the archive records a complete decompressed-member roundtrip and unchanged original hashes. No ROOT file was written during packaging and no experiment was rerun.
