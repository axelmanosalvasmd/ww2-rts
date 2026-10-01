# Model reference assets (not part of the game)

Reference sheets used to build the unit models in client/models/ (front, side, top and three-quarter views per unit
type and faction, generated with gpt-image-2). They were photographed like miniatures: use them for shape, proportions
and part layout only, not for paint or style (the game aims for a realistic RTS look).

- refs/<type>-<fac>.jpg: one sheet per unit type and faction (fac 0 USA, 1 Germany, 2 USSR); index.json describes each.
- refs/last-critic-scores.json: the last independent critic scores and top fixes per model family.
- refs/research.md: notes on procedural three.js model techniques and budgets.
- refs/texture-sources/: the full-size gpt-image-2 textures behind client/textures/models/.

tools/model-shots.sh compares the viewer against a sheet when REFS points at a folder of <type>-<fac>.png files:
convert these jpgs to png (or adjust the script) and set REFS=<that folder>.
