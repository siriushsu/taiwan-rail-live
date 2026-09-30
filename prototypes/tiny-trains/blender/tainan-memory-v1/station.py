"""臺南舊站房（1936 年二層站房）幾何組裝：主棟、門廊與雨庇、立面元素、橫翼。尺寸與依據見 common.py。"""
from common import *
import block
import porch
import facade
import wings


def build():
    G = Geo()
    block.main_block(G)
    porch.porch(G)
    facade.facade(G)
    wings.wings(G)
    return G
