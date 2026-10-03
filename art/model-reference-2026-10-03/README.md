# WW2 model references

Three images generated with the requested Codex Image skill on 2026-10-03. These are visual modeling references, not verified historical blueprints. Runtime model changes should use their proportions and material treatment with judgment.

| File | Subjects | Requested size | Actual size | Requested quality | Resolved quality |
| --- | --- | --- | --- | --- | --- |
| ground-units-multiview.png | US infantry, Sherman tank, BA-64 scout car | 2048x2048 | 1536x1024 | low | medium |
| naval-air-hq-multiview.png | PT boat, P-51 fighter, timber HQ | 2048x2048 | 1536x1024 | low | medium |
| painted-steel-albedo.png | Subtle painted metal grain | 1024x1024 | 1254x1254 | low | low |

The backend reported `gpt-image-2-codex` for every image. Each PNG has a JSON sidecar with the exact prompt, requested settings, backend metadata, and measured dimensions.

Both sheets include front, left, back, right, and top views. The infantry sheet shows compact fitted kit and useful body proportions. The boat and HQ silhouettes are readable. Some fighter front and back wing tips touch or extend beyond their cells, so use the top view for the full wing plan. Small details and agreement between views remain approximate.

The steel texture has restrained grain and scratches with no visible symbols or large rust patches. Its mean RGB value is approximately 118, 117, 115, so it is slightly warm rather than strictly grayscale. Opposite-edge average channel differences are about 6.7 and 7.1 on a 0 to 255 scale. It was requested as seamless, but exact seamlessness is not established. Check repetition at the intended UV scale before using it on models.

All three saved images were opened and inspected. No generated runtime asset or model is implied by these references alone.

The painted-steel reference is used in the game as
`client/textures/models/armor-paint-refined.jpg`, converted to a 512 by 512 JPEG
for the existing texture array. The shader uses its brightness only, preserving
faction colors. The prior `armor-paint.jpg` remains available for comparison.
