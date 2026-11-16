"""Abre o Josué: liga o servidor local (escondido) e abre a janela do app.

Usado pelo atalho da versão instalada:  runtime\\pythonw.exe server\\josue.pyw
Ao fechar a janela, o servidor é desligado.
"""
import os
import shutil
import subprocess
import sys
import time
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # pasta de instalação
SERVER = os.path.join(ROOT, "server")
PORT = 8765
URL = f"http://127.0.0.1:{PORT}/"
USER = os.path.join(os.environ.get("LOCALAPPDATA", ROOT), "Josue")


def env():
    e = dict(os.environ)
    e.update(
        HF_HOME=os.path.join(ROOT, "models", "hf"),
        TORCH_HOME=os.path.join(ROOT, "models", "torch"),
        JOSUE_DATA=os.path.join(USER, "dados"),
        JOSUE_WEB=os.path.join(ROOT, "web"),
        HF_HUB_DISABLE_SYMLINKS_WARNING="1",
        PYTHONIOENCODING="utf-8",
    )
    return e


def alive() -> bool:
    try:
        with urllib.request.urlopen(URL + "health", timeout=1) as r:
            return r.status == 200
    except Exception:  # noqa: BLE001
        return False


def browser() -> list[str] | None:
    pf = [os.environ.get(k, "") for k in ("ProgramFiles(x86)", "ProgramFiles", "LOCALAPPDATA")]
    for base in pf:
        for rel in (r"Microsoft\Edge\Application\msedge.exe", r"Google\Chrome\Application\chrome.exe"):
            p = os.path.join(base, rel)
            if base and os.path.exists(p):
                return [p]
    for name in ("msedge", "chrome"):
        p = shutil.which(name)
        if p:
            return [p]
    return None


def main():
    os.makedirs(USER, exist_ok=True)
    started = None
    if not alive():
        log = open(os.path.join(USER, "servidor.log"), "a", encoding="utf-8")
        py = os.path.join(ROOT, "runtime", "python.exe")
        started = subprocess.Popen(
            [py, "chords_server.py"], cwd=SERVER, env=env(), stdout=log, stderr=log,
            creationflags=subprocess.CREATE_NO_WINDOW,
        )
    # tela de "abrindo…" enquanto os modelos carregam
    loading = "file:///" + os.path.join(ROOT, "web", "abrindo.html").replace("\\", "/")
    exe = browser()
    if not exe:
        for _ in range(240):
            if alive():
                break
            time.sleep(0.5)
        os.startfile(URL)  # sem Edge/Chrome: abre no navegador padrão e mantém o servidor ligado
        return
    win = subprocess.Popen(exe + [
        f"--app={loading if not alive() else URL}",
        f"--user-data-dir={os.path.join(USER, 'janela')}",
        "--no-first-run", "--no-default-browser-check", "--window-size=1440,900",
    ])
    t0 = time.time()
    win.wait()
    if started is None:
        return
    if time.time() - t0 < 5:
        # a janela foi entregue a outra instância já aberta: espera o servidor parar de ser usado
        return
    started.terminate()
    try:
        started.wait(10)
    except subprocess.TimeoutExpired:
        started.kill()


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # noqa: BLE001
        with open(os.path.join(USER, "erro.log"), "a", encoding="utf-8") as f:
            f.write(f"{time.ctime()}: {e!r}\n")
        sys.exit(1)
