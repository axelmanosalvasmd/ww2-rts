# Rubble material atlas provenance

Generated on 2026-10-03 with the explicitly requested `codex-image` skill using `gpt-image-2-codex`, medium quality and native alpha through the configured proxy route. One source generation produced a 1254 by 1254 RGBA PNG.

The game uses `client/textures/fx-rubble-materials-v1.webp`, resized to 768 by 768 and encoded with FFmpeg libwebp quality 88, compression level 6. It is 256,082 bytes. No external reference image was used.

Quadrants, read from top left: brick and mortar, concrete and stone, splintered timber, soil clods. The atlas only adds visual detail to recipient-known authoritative rubble cells. It does not change terrain, collision, cover or navigation. Stone, concrete and steel use the concrete quadrant; wood uses timber; soil and road use soil. Unspecified material uses brick.

The source alpha contains 822,024 fully transparent pixels, 539 fully opaque pixels and 749,953 partially transparent pixels. Grass compositing was inspected at RGB (89, 98, 54); road and black comparison composites were also produced in temporary proof storage.

## Original prompt

Use case: stylized-concept. Asset type: transparent 2 by 2 material rubble decal texture atlas for the Three Crossroads WW2 RTS. Primary request: four isolated sparse debris scatters, each centered in its own equal square quadrant with generous transparent padding between quadrants. Upper left: reddish broken brick and pale mortar. Upper right: gray chipped concrete and small stone. Lower left: dark brown splintered timber and chips. Lower right: loose brown soil clods and dirt grains. View all four directly from overhead with the same scale and diffuse neutral light. Match realistic game texture photography with muted earth colors and readable small fragments. Text: none. Keep each scatter inside its quadrant and the canvas alpha genuinely transparent, suitable for compositing over existing terrain. No letters, numbers, borders or watermarks.

## Transparency suffix added by the skill

Output the isolated subject on a genuinely transparent background with actual alpha.

## Conversion command

```sh
ffmpeg -i client/textures/fx-rubble-materials-v1.png -vf scale=768:768 -c:v libwebp -quality 88 -compression_level 6 client/textures/fx-rubble-materials-v1.webp
```
