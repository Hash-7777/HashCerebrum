# Brain Model Asset

## Active model

- File: `science-museum-human-brain.glb`
- Title: `Model of a human brain`
- Creator / collection: Science Museum Group
- Source: https://sketchfab.com/3d-models/model-of-a-human-brain-fc7ae7b989f94c80a50152e71f44e47c
- Collection page: https://collection.sciencemuseumgroup.org.uk/objects/co77087/model-of-a-human-brain
- License metadata in GLB: `CC0-1.0`
- License URL: http://creativecommons.org/publicdomain/zero/1.0/

The bundled GLB metadata identifies the asset as public domain under CC0-1.0.
Attribution is not required by CC0, but the app keeps this source note so the
asset provenance is auditable before any public release.

The model exposes eight generic mesh nodes (`Object_2` through `Object_9`).
HashCerebrum maps these visible chunks to broad research regions in
`src/features/brain/data/modelParts.ts`. The source GLB does not separately
name internal structures such as hippocampus, amygdala, thalamus, or basal
ganglia, so those are assigned to the closest visible chunk for the first mode.
