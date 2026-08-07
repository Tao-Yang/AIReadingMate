"""下载 ECDICT 词典 CSV（英译中离线注释用）。

用法：
    python download_ecdict.py            # -> ../data/ecdict.csv
    python download_ecdict.py 路径.csv   # 自定义目标

ECDICT 为 MIT 许可：https://github.com/skywind3000/ECDICT
"""

import os
import sys
import urllib.request

URL = "https://raw.githubusercontent.com/skywind3000/ECDICT/master/ecdict.csv"
DEFAULT_DEST = os.path.join(os.path.dirname(__file__), "..", "data", "ecdict.csv")


def download(dest: str) -> None:
    os.makedirs(os.path.dirname(dest) or ".", exist_ok=True)
    print("Downloading ECDICT (~65 MB) from %s ..." % URL)

    def _hook(block_num, block_size, total_size):
        if total_size > 0:
            done = min(block_num * block_size, total_size)
            pct = done * 100 / total_size
            sys.stdout.write("\r  %6.2f%% (%d/%d bytes)" % (pct, done, total_size))
            sys.stdout.flush()

    urllib.request.urlretrieve(URL, dest, _hook)
    print("\nSaved to %s" % os.path.abspath(dest))


if __name__ == "__main__":
    destination = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_DEST
    download(destination)
