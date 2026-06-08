import asyncio
import sys
import types
from http.client import IncompleteRead
from pathlib import Path

import pytest

import local_translation_model
import main


@pytest.fixture(autouse=True)
def reset_translation_model_runtime(monkeypatch):
    local_translation_model.unload_translation_model()
    monkeypatch.setattr(local_translation_model, "run_translation_model_self_test", lambda *_args, **_kwargs: None)
    yield
    local_translation_model.unload_translation_model()


def create_cached_translation_model(tmp_path, profile_id=local_translation_model.STANDARD_TRANSLATION_PROFILE, snapshot_name="snapshot-a"):
    profile = local_translation_model.get_translation_profile(profile_id)
    snapshot = (
        tmp_path
        / local_translation_model.repo_cache_dir_name(profile["gguf_repo_id"])
        / "snapshots"
        / snapshot_name
    )
    snapshot.mkdir(parents=True)
    model_file = snapshot / profile["model_file"]
    model_file.write_bytes(b"gguf")
    return model_file


def test_translation_model_status_detects_cached_gguf(tmp_path, monkeypatch):
    monkeypatch.setenv(local_translation_model.TRANSLATION_MODEL_CACHE_DIR_ENV, str(tmp_path))
    model_file = create_cached_translation_model(tmp_path)

    status = local_translation_model.get_translation_model_status()

    assert status["cached"] is True
    assert status["model_path"] == str(model_file)
    assert status["repo_id"] == "tencent/Hy-MT2-1.8B Q4_K_M"
    assert status["runtime_profile"] == local_translation_model.STANDARD_TRANSLATION_PROFILE


def test_translation_model_status_ignores_legacy_hymt15_cache(tmp_path, monkeypatch):
    monkeypatch.setenv(local_translation_model.TRANSLATION_MODEL_CACHE_DIR_ENV, str(tmp_path))
    legacy_snapshot = (
        tmp_path
        / local_translation_model.repo_cache_dir_name(local_translation_model.LEGACY_TRANSLATION_MODEL_GGUF_REPO_ID)
        / "snapshots"
        / "snapshot-a"
    )
    legacy_snapshot.mkdir(parents=True)
    (legacy_snapshot / "Hy-MT1.5-1.8B-2bit.gguf").write_bytes(b"legacy")

    status = local_translation_model.get_translation_model_status()

    assert status["cached"] is False
    assert status["available_profiles"] == []
    assert "Hy-MT1.5" not in status["repo_id"]


def test_translation_model_load_reports_runtime_missing_for_cached_model(tmp_path, monkeypatch):
    monkeypatch.setenv(local_translation_model.TRANSLATION_MODEL_CACHE_DIR_ENV, str(tmp_path))
    monkeypatch.delenv(local_translation_model.BUNDLED_LLAMA_SERVER_PATH_ENV, raising=False)
    monkeypatch.delenv("SPEAKMORE_LLAMA_SERVER_PATH", raising=False)
    monkeypatch.delenv("LLAMA_SERVER_PATH", raising=False)
    monkeypatch.delenv("SPEAKMORE_LOCAL_TRANSLATION_SERVER_URL", raising=False)
    monkeypatch.setattr(local_translation_model.shutil, "which", lambda _name: None)
    monkeypatch.setattr(local_translation_model, "has_llama_cpp_python_server", lambda: False)
    create_cached_translation_model(tmp_path)

    status = local_translation_model.load_translation_model()

    assert status["status"] == "runtime_missing"
    assert status["runtime_missing"] is True
    assert "llama-server" in status["detail"]
    assert "llama-cpp-python" in status["detail"]


def test_translation_model_status_reports_bundled_llama_server(tmp_path, monkeypatch):
    llama_server = tmp_path / "llama-server.exe"
    llama_server.write_bytes(b"runtime")
    monkeypatch.setenv(local_translation_model.BUNDLED_LLAMA_SERVER_PATH_ENV, str(llama_server))
    monkeypatch.delenv("SPEAKMORE_LLAMA_SERVER_PATH", raising=False)
    monkeypatch.delenv("LLAMA_SERVER_PATH", raising=False)
    monkeypatch.setattr(local_translation_model.shutil, "which", lambda _name: None)
    monkeypatch.setattr(local_translation_model, "has_llama_cpp_python_server", lambda: False)

    status = local_translation_model.get_translation_model_status()

    assert status["runtime_available"] is True
    assert status["runtime_path"] == str(llama_server)
    assert status["runtime_source"] == "bundled"
    assert status["runtime_kind_available"] == "llama-server"
    assert status["standard_runtime_available"] is True


def test_llama_cpp_python_server_probe_handles_missing_parent_package(monkeypatch):
    def fake_find_spec(_name):
        raise ModuleNotFoundError("No module named 'llama_cpp'")

    monkeypatch.setattr(local_translation_model.importlib.util, "find_spec", fake_find_spec)

    assert local_translation_model.has_llama_cpp_python_server() is False


def test_translation_model_load_can_use_llama_cpp_python_server(tmp_path, monkeypatch):
    monkeypatch.setenv(local_translation_model.TRANSLATION_MODEL_CACHE_DIR_ENV, str(tmp_path))
    monkeypatch.delenv(local_translation_model.BUNDLED_LLAMA_SERVER_PATH_ENV, raising=False)
    monkeypatch.delenv("SPEAKMORE_LLAMA_SERVER_PATH", raising=False)
    monkeypatch.delenv("LLAMA_SERVER_PATH", raising=False)
    monkeypatch.delenv("SPEAKMORE_LOCAL_TRANSLATION_SERVER_URL", raising=False)
    monkeypatch.setattr(local_translation_model.shutil, "which", lambda _name: None)
    monkeypatch.setattr(local_translation_model, "has_llama_cpp_python_server", lambda: True)
    monkeypatch.setattr(local_translation_model, "wait_for_local_server", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(
        local_translation_model.socket,
        "create_connection",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(OSError()),
    )
    model_file = create_cached_translation_model(tmp_path)
    popen_calls = []

    class FakeProcess:
        pid = 12345

        def poll(self):
            return None

        def terminate(self):
            pass

        def wait(self, timeout=None):
            del timeout
            return 0

    def fake_popen(args, **kwargs):
        popen_calls.append((args, kwargs))
        return FakeProcess()

    monkeypatch.setattr(local_translation_model.subprocess, "Popen", fake_popen)

    status = local_translation_model.load_translation_model()
    local_translation_model.unload_translation_model()

    assert status["status"] == "ready"
    assert status["runtime_kind"] == "llama-cpp-python"
    assert popen_calls
    args = popen_calls[0][0]
    assert args[:3] == [local_translation_model.sys.executable, "-m", "llama_cpp.server"]
    assert "--model" in args
    assert str(model_file) in args


def test_translation_model_load_uses_bundled_llama_server(tmp_path, monkeypatch):
    monkeypatch.setenv(local_translation_model.TRANSLATION_MODEL_CACHE_DIR_ENV, str(tmp_path))
    monkeypatch.delenv("SPEAKMORE_LLAMA_SERVER_PATH", raising=False)
    monkeypatch.delenv("LLAMA_SERVER_PATH", raising=False)
    monkeypatch.delenv("SPEAKMORE_LOCAL_TRANSLATION_SERVER_URL", raising=False)
    monkeypatch.setattr(local_translation_model.shutil, "which", lambda _name: None)
    monkeypatch.setattr(local_translation_model, "has_llama_cpp_python_server", lambda: False)
    monkeypatch.setattr(local_translation_model, "wait_for_local_server", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(
        local_translation_model.socket,
        "create_connection",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(OSError()),
    )
    model_file = create_cached_translation_model(tmp_path)
    llama_server = tmp_path / "llama-server.exe"
    llama_server.write_bytes(b"runtime")
    monkeypatch.setenv(local_translation_model.BUNDLED_LLAMA_SERVER_PATH_ENV, str(llama_server))
    popen_calls = []

    class FakeProcess:
        pid = 12345

        def poll(self):
            return None

        def terminate(self):
            pass

        def wait(self, timeout=None):
            del timeout
            return 0

    def fake_popen(args, **kwargs):
        popen_calls.append((args, kwargs))
        return FakeProcess()

    monkeypatch.setattr(local_translation_model.subprocess, "Popen", fake_popen)

    status = local_translation_model.load_translation_model()
    local_translation_model.unload_translation_model()

    assert status["status"] == "ready"
    assert status["runtime_kind"] == "llama-server"
    assert status["runtime_profile"] == local_translation_model.STANDARD_TRANSLATION_PROFILE
    args = popen_calls[0][0]
    assert args[0] == str(llama_server)
    assert "--model" in args
    assert str(model_file) in args


def test_translation_model_load_reports_model_log_failure(tmp_path, monkeypatch):
    monkeypatch.setenv(local_translation_model.TRANSLATION_MODEL_CACHE_DIR_ENV, str(tmp_path))
    monkeypatch.delenv("SPEAKMORE_LLAMA_SERVER_PATH", raising=False)
    monkeypatch.delenv("LLAMA_SERVER_PATH", raising=False)
    monkeypatch.delenv("SPEAKMORE_LOCAL_TRANSLATION_SERVER_URL", raising=False)
    monkeypatch.setattr(local_translation_model.shutil, "which", lambda _name: None)
    monkeypatch.setattr(local_translation_model, "has_llama_cpp_python_server", lambda: False)
    monkeypatch.setattr(
        local_translation_model.socket,
        "create_connection",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(OSError()),
    )
    create_cached_translation_model(tmp_path)
    llama_server = tmp_path / "llama-server.exe"
    llama_server.write_bytes(b"runtime")
    monkeypatch.setenv(local_translation_model.BUNDLED_LLAMA_SERVER_PATH_ENV, str(llama_server))

    class FailedProcess:
        pid = 12345
        returncode = 1

        def poll(self):
            return 1

        def terminate(self):
            pass

        def wait(self, timeout=None):
            del timeout
            return 1

    def fake_popen(args, **kwargs):
        del args
        kwargs["stdout"].write("gguf_init_from_reader: failed to read tensor data\nfailed to load model\n")
        kwargs["stdout"].flush()
        return FailedProcess()

    monkeypatch.setattr(local_translation_model.subprocess, "Popen", fake_popen)

    with pytest.raises(RuntimeError, match="could not be loaded"):
        local_translation_model.load_translation_model()

    status = local_translation_model.get_translation_model_status()
    assert status["status"] == "failed"
    assert "cached GGUF" in status["detail"]
    assert status["runtime_log_path"].endswith("llama-server.log")


def test_translation_model_status_prefers_stq_profile_when_runtime_exists(tmp_path, monkeypatch):
    monkeypatch.setenv(local_translation_model.TRANSLATION_MODEL_CACHE_DIR_ENV, str(tmp_path))
    stq_model_file = create_cached_translation_model(tmp_path, local_translation_model.STQ_TRANSLATION_PROFILE)
    create_cached_translation_model(tmp_path, local_translation_model.STANDARD_TRANSLATION_PROFILE)
    stq_runtime = tmp_path / "stq" / "llama-server.exe"
    stq_runtime.parent.mkdir()
    stq_runtime.write_bytes(b"runtime")
    monkeypatch.setenv(local_translation_model.BUNDLED_HYMT_LLAMA_SERVER_PATH_ENV, str(stq_runtime))
    monkeypatch.delenv(local_translation_model.BUNDLED_LLAMA_SERVER_PATH_ENV, raising=False)
    monkeypatch.setattr(local_translation_model.shutil, "which", lambda _name: None)
    monkeypatch.setattr(local_translation_model, "has_llama_cpp_python_server", lambda: False)

    status = local_translation_model.get_translation_model_status()

    assert status["cached"] is True
    assert status["runtime_profile"] == local_translation_model.STQ_TRANSLATION_PROFILE
    assert status["model_path"] == str(stq_model_file)
    assert status["repo_id"] == "tencent/Hy-MT2-1.8B-1.25Bit"
    assert status["stq_runtime_available"] is True


def test_translation_model_download_chooses_stq_when_runtime_exists(tmp_path, monkeypatch):
    monkeypatch.setenv(local_translation_model.TRANSLATION_MODEL_CACHE_DIR_ENV, str(tmp_path))
    stq_runtime = tmp_path / "stq" / "llama-server.exe"
    stq_runtime.parent.mkdir()
    stq_runtime.write_bytes(b"runtime")
    monkeypatch.setenv(local_translation_model.BUNDLED_HYMT_LLAMA_SERVER_PATH_ENV, str(stq_runtime))
    calls = []

    def fake_snapshot_download(**kwargs):
        calls.append(kwargs)
        profile = local_translation_model.get_translation_profile(local_translation_model.STQ_TRANSLATION_PROFILE)
        snapshot = tmp_path / "downloaded-stq"
        snapshot.mkdir()
        (snapshot / profile["model_file"]).write_bytes(b"gguf")
        return str(snapshot)

    monkeypatch.setitem(sys.modules, "huggingface_hub", types.SimpleNamespace(snapshot_download=fake_snapshot_download))

    model_file = local_translation_model.download_translation_model()

    assert model_file.name == "Hy-MT2-1.8B-1.25Bit.gguf"
    assert calls[0]["repo_id"] == "tencent/Hy-MT2-1.8B-1.25Bit-GGUF"


def test_translation_model_download_uses_standard_when_stq_runtime_missing(tmp_path, monkeypatch):
    monkeypatch.setenv(local_translation_model.TRANSLATION_MODEL_CACHE_DIR_ENV, str(tmp_path))
    monkeypatch.delenv(local_translation_model.BUNDLED_HYMT_LLAMA_SERVER_PATH_ENV, raising=False)
    calls = []

    def fake_snapshot_download(**kwargs):
        calls.append(kwargs)
        profile = local_translation_model.get_translation_profile(local_translation_model.STANDARD_TRANSLATION_PROFILE)
        snapshot = tmp_path / "downloaded-standard"
        snapshot.mkdir()
        (snapshot / profile["model_file"]).write_bytes(b"gguf")
        return str(snapshot)

    monkeypatch.setitem(sys.modules, "huggingface_hub", types.SimpleNamespace(snapshot_download=fake_snapshot_download))

    model_file = local_translation_model.download_translation_model()

    assert model_file.name == "Hy-MT2-1.8B-Q4_K_M.gguf"
    assert calls[0]["repo_id"] == "tencent/Hy-MT2-1.8B-GGUF"
    assert calls[0]["resume_download"] is True
    assert calls[0]["max_workers"] == 2


def test_translation_model_download_retries_interrupted_download_and_keeps_partial_cache(tmp_path, monkeypatch):
    monkeypatch.setenv(local_translation_model.TRANSLATION_MODEL_CACHE_DIR_ENV, str(tmp_path))
    profile = local_translation_model.get_translation_profile(local_translation_model.STANDARD_TRANSLATION_PROFILE)
    partial_blob = (
        tmp_path
        / local_translation_model.repo_cache_dir_name(profile["gguf_repo_id"])
        / "blobs"
        / "dc5f44fcf1fa496ee7ad725982c0c8c553a4de00259b53af84c4b89fb0c06699.incomplete"
    )
    partial_blob.parent.mkdir(parents=True)
    partial_blob.write_bytes(b"partial")
    calls = []

    def fake_snapshot_download(**kwargs):
        calls.append(kwargs)
        if len(calls) == 1:
            raise IncompleteRead(b"partial", 12)
        snapshot = tmp_path / "downloaded-standard"
        snapshot.mkdir(exist_ok=True)
        (snapshot / profile["model_file"]).write_bytes(b"gguf")
        return str(snapshot)

    monkeypatch.setitem(sys.modules, "huggingface_hub", types.SimpleNamespace(snapshot_download=fake_snapshot_download))
    monkeypatch.setattr(local_translation_model.time, "sleep", lambda _seconds: None)

    model_file = local_translation_model.download_translation_model()

    assert model_file.name == "Hy-MT2-1.8B-Q4_K_M.gguf"
    assert len(calls) == 2
    assert partial_blob.is_file()


def test_translation_model_download_normalizes_interrupted_error_after_retries(tmp_path, monkeypatch):
    monkeypatch.setenv(local_translation_model.TRANSLATION_MODEL_CACHE_DIR_ENV, str(tmp_path))

    def fake_snapshot_download(**_kwargs):
        raise IncompleteRead(b"partial", 12)

    monkeypatch.setitem(sys.modules, "huggingface_hub", types.SimpleNamespace(snapshot_download=fake_snapshot_download))
    monkeypatch.setattr(local_translation_model.time, "sleep", lambda _seconds: None)

    with pytest.raises(RuntimeError, match=local_translation_model.DOWNLOAD_INTERRUPTED_DETAIL_CODE):
        local_translation_model.download_translation_model()


def test_translation_model_download_failure_detail_does_not_double_prefix():
    detail = "translation_model_download_failed: permission denied"

    assert local_translation_model.build_translation_model_download_failure_detail(RuntimeError(detail)) == detail


def test_local_translation_prompt_uses_single_user_message():
    messages = local_translation_model.build_local_translation_messages(
        raw_text="今天确认发布计划。",
        target_language_name="English",
        target_language_id="en",
        previous_sentences=["昨天讨论了客户演示。"],
        previous_context_pairs=[{"source": "发布计划", "translation": "launch plan"}],
    )

    assert len(messages) == 1
    assert messages[0]["role"] == "user"
    assert "Translate the following text into English (en)" in messages[0]["content"]
    assert "Do not translate or repeat this context" in messages[0]["content"]
    assert "launch plan" in messages[0]["content"]


def test_translation_model_load_attaches_existing_llama_server_on_same_port(tmp_path, monkeypatch):
    monkeypatch.setenv(local_translation_model.TRANSLATION_MODEL_CACHE_DIR_ENV, str(tmp_path))
    model_file = create_cached_translation_model(tmp_path)
    runtime = tmp_path / "llama-server.exe"
    runtime.write_bytes(b"runtime")
    monkeypatch.setenv(local_translation_model.BUNDLED_LLAMA_SERVER_PATH_ENV, str(runtime))
    monkeypatch.delenv("SPEAKMORE_LOCAL_TRANSLATION_SERVER_URL", raising=False)
    monkeypatch.setattr(local_translation_model.shutil, "which", lambda _name: None)
    monkeypatch.setattr(local_translation_model, "has_llama_cpp_python_server", lambda: False)
    monkeypatch.setattr(local_translation_model, "is_runtime_serving_translation_model", lambda url, path: url == "http://127.0.0.1:8105" and path == model_file)

    class ExistingSocket:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

    monkeypatch.setattr(local_translation_model.socket, "create_connection", lambda *_args, **_kwargs: ExistingSocket())

    status = local_translation_model.load_translation_model()

    assert status["ready"] is True
    assert status["runtime_kind"] == "llama-server-existing"
    assert status["runtime_url"] == "http://127.0.0.1:8105"
    assert status["runtime_pid"] is None


def test_translation_model_load_marks_failed_when_self_test_outputs_question_marks(tmp_path, monkeypatch):
    monkeypatch.setenv(local_translation_model.TRANSLATION_MODEL_CACHE_DIR_ENV, str(tmp_path))
    create_cached_translation_model(tmp_path)
    runtime = tmp_path / "llama-server.exe"
    runtime.write_bytes(b"runtime")
    monkeypatch.setenv(local_translation_model.BUNDLED_LLAMA_SERVER_PATH_ENV, str(runtime))
    monkeypatch.delenv("SPEAKMORE_LOCAL_TRANSLATION_SERVER_URL", raising=False)
    monkeypatch.setattr(local_translation_model.shutil, "which", lambda _name: None)
    monkeypatch.setattr(local_translation_model, "has_llama_cpp_python_server", lambda: False)
    monkeypatch.setattr(local_translation_model, "wait_for_local_server", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(
        local_translation_model.socket,
        "create_connection",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(OSError()),
    )

    class FakeProcess:
        pid = 12345

        def poll(self):
            return None

        def terminate(self):
            pass

        def wait(self, timeout=None):
            del timeout
            return 0

    monkeypatch.setattr(local_translation_model.subprocess, "Popen", lambda *_args, **_kwargs: FakeProcess())
    monkeypatch.setattr(
        local_translation_model,
        "run_translation_model_self_test",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            local_translation_model.TranslationModelSelfTestError(
                f"{local_translation_model.SELF_TEST_FAILED_DETAIL_CODE}: ???????"
            )
        ),
    )

    with pytest.raises(RuntimeError, match=local_translation_model.SELF_TEST_FAILED_DETAIL_CODE):
        local_translation_model.load_translation_model()

    status = local_translation_model.get_translation_model_status()
    assert status["status"] == "failed_self_test"
    assert status["ready"] is False
    assert status["self_test_passed"] is False


def test_local_translation_rejects_question_mark_output():
    assert local_translation_model.is_invalid_local_translation_output("????????", "今天天气很好。") is True
    assert local_translation_model.is_invalid_local_translation_output("The weather is nice today.", "今天天气很好。") is False


def test_translation_model_download_cleans_legacy_lock_without_removing_hymt2_partial(tmp_path, monkeypatch):
    monkeypatch.setenv(local_translation_model.TRANSLATION_MODEL_CACHE_DIR_ENV, str(tmp_path))
    legacy_lock = tmp_path / ".locks" / local_translation_model.repo_cache_dir_name(local_translation_model.LEGACY_TRANSLATION_MODEL_GGUF_REPO_ID)
    legacy_lock.mkdir(parents=True)
    (legacy_lock / "stale.lock").write_text("legacy", encoding="utf-8")
    profile = local_translation_model.get_translation_profile(local_translation_model.STANDARD_TRANSLATION_PROFILE)
    partial_blob = (
        tmp_path
        / local_translation_model.repo_cache_dir_name(profile["gguf_repo_id"])
        / "blobs"
        / "model.incomplete"
    )
    partial_blob.parent.mkdir(parents=True)
    partial_blob.write_bytes(b"partial")

    def fake_snapshot_download(**_kwargs):
        snapshot = tmp_path / "downloaded-standard"
        snapshot.mkdir(exist_ok=True)
        (snapshot / profile["model_file"]).write_bytes(b"gguf")
        return str(snapshot)

    monkeypatch.setitem(sys.modules, "huggingface_hub", types.SimpleNamespace(snapshot_download=fake_snapshot_download))

    local_translation_model.download_translation_model()

    assert legacy_lock.exists() is False
    assert partial_blob.is_file()


def test_translation_model_load_falls_back_to_standard_when_stq_runtime_fails(tmp_path, monkeypatch):
    monkeypatch.setenv(local_translation_model.TRANSLATION_MODEL_CACHE_DIR_ENV, str(tmp_path))
    stq_model_file = create_cached_translation_model(tmp_path, local_translation_model.STQ_TRANSLATION_PROFILE)
    standard_model_file = create_cached_translation_model(tmp_path, local_translation_model.STANDARD_TRANSLATION_PROFILE)
    stq_runtime = tmp_path / "stq" / "llama-server.exe"
    standard_runtime = tmp_path / "standard" / "llama-server.exe"
    stq_runtime.parent.mkdir()
    standard_runtime.parent.mkdir()
    stq_runtime.write_bytes(b"runtime")
    standard_runtime.write_bytes(b"runtime")
    monkeypatch.setenv(local_translation_model.BUNDLED_HYMT_LLAMA_SERVER_PATH_ENV, str(stq_runtime))
    monkeypatch.setenv(local_translation_model.BUNDLED_LLAMA_SERVER_PATH_ENV, str(standard_runtime))
    monkeypatch.delenv("SPEAKMORE_LOCAL_TRANSLATION_SERVER_URL", raising=False)
    monkeypatch.setattr(local_translation_model.shutil, "which", lambda _name: None)
    monkeypatch.setattr(local_translation_model, "has_llama_cpp_python_server", lambda: False)
    monkeypatch.setattr(
        local_translation_model.socket,
        "create_connection",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(OSError()),
    )
    starts = []

    class FakeProcess:
        pid = 12345
        returncode = None

        def poll(self):
            return None

        def terminate(self):
            pass

        def wait(self, timeout=None):
            del timeout
            return 0

    def fake_popen(args, **kwargs):
        starts.append(args)
        return FakeProcess()

    def fake_wait(_url, **kwargs):
        model_path = kwargs.get("process") and starts[-1][starts[-1].index("--model") + 1]
        if model_path == str(stq_model_file):
            raise RuntimeError("STQ runtime failed")

    monkeypatch.setattr(local_translation_model.subprocess, "Popen", fake_popen)
    monkeypatch.setattr(local_translation_model, "wait_for_local_server", fake_wait)

    status = local_translation_model.load_translation_model()

    assert status["status"] == "ready"
    assert status["runtime_profile"] == local_translation_model.STANDARD_TRANSLATION_PROFILE
    assert starts[0][0] == str(stq_runtime)
    assert str(stq_model_file) in starts[0]
    assert starts[1][0] == str(standard_runtime)
    assert str(standard_model_file) in starts[1]


def test_translate_text_with_engine_uses_local_model_when_ready(monkeypatch):
    async def fake_local(**kwargs):
        assert kwargs["target_language_id"] == "en"
        return "Hello"

    monkeypatch.setattr(main, "get_translation_model_status", lambda: {"ready": True, "status": "ready"})
    monkeypatch.setattr(main, "translate_with_local_model", fake_local)

    result = asyncio.run(main.translate_text_with_engine(
        raw_text="你好",
        target_language="en",
        context={},
        parameters={"translation_engine_preference": "auto"},
    ))

    assert result["text"] == "Hello"
    assert result["translation_engine"] == "local_hy_mt"
    assert result["local_model_status"] == "ready"


def test_translate_text_with_engine_falls_back_to_llm_in_auto(monkeypatch):
    async def fake_local(**_kwargs):
        raise RuntimeError("runtime failed")

    async def fake_refine_text(**kwargs):
        assert kwargs["mode"] == "translation"
        return "Hello from LLM"

    monkeypatch.setattr(main, "get_translation_model_status", lambda: {"ready": True, "status": "ready"})
    monkeypatch.setattr(main, "translate_with_local_model", fake_local)
    monkeypatch.setattr(main, "refine_text", fake_refine_text)

    result = asyncio.run(main.translate_text_with_engine(
        raw_text="你好",
        target_language="en",
        context={},
        parameters={"translation_engine_preference": "auto"},
    ))

    assert result["text"] == "Hello from LLM"
    assert result["translation_engine"] == "llm"
    assert result["local_model_status"] == "failed"


def test_translate_text_with_engine_raises_when_local_is_forced_but_unready(monkeypatch):
    monkeypatch.setattr(main, "get_translation_model_status", lambda: {
        "ready": False,
        "status": "runtime_missing",
        "detail": local_translation_model.RUNTIME_MISSING_DETAIL,
    })

    with pytest.raises(RuntimeError, match="llama-server"):
        asyncio.run(main.translate_text_with_engine(
            raw_text="你好",
            target_language="en",
            context={},
            parameters={"translation_engine_preference": "local"},
        ))
