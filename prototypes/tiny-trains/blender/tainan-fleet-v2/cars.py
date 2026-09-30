"""車款註冊表：各 t_*.py 模組提供 BUILDERS[id](lod)->(Mesh, spec)。lod=0 近景、lod=1 遠景。"""
import importlib
BUILDERS = {}
for _mod in ('t_emu3000', 't_emu800', 't_temu2000', 't_pp', 't_loco'):
    try:
        _m = importlib.import_module(_mod)
    except ModuleNotFoundError as e:
        if e.name != _mod:
            raise
        continue
    BUILDERS.update(_m.BUILDERS)
