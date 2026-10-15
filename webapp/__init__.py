# webapp 包：把桌面版行程工具移植为手机端 Web 应用
import os
import sys

# 确保项目根目录（含 core.py / china_regions.json）在导入路径中
_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)