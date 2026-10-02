"""Dreambound: the survey relay room at the bottom of the Tower's bunker stair (design in bunker_design.py), built with dbkit.py.

Headless:   blender --background --factory-startup --python tools/blender/build_bunker.py
Live (MCP): STAGE = 'build'; exec(open(r'C:/repos/Dreambound/tools/blender/build_bunker.py').read())
Env:        BUNKER_QUICK=1    a small, noisy lightmap and panorama (layout work, about a minute);
            BUNKER_SKIPTEX=1  keep the texture PNGs already in public/models (relight only);
            BUNKER_PREVIEW=<dir>  where the preview renders go (default %TEMP%/dreambound_bunker);
            BUNKER_NOPREVIEW=1    skip the preview renders.
"""
KIT = r"C:/repos/Dreambound/tools/blender/dbkit.py"
exec(compile(open(KIT, encoding='utf-8').read(), KIT, 'exec'))
configure('bunker', 'bunker_', 'Dreambound_Bunker', ao_size=2048, uv_method='smart')
result = main(globals())
