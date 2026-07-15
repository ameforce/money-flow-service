from collections.abc import Mapping


class STARTUPINFO:
    dwFlags: int
    wShowWindow: int
    hStdInput: int
    hStdOutput: int
    hStdError: int


def CreateProcess(
    appName: str | None,
    commandLine: str,
    processAttributes: None,
    threadAttributes: None,
    inheritHandles: bool,
    creationFlags: int,
    environment: Mapping[str, str] | None,
    currentDirectory: str | None,
    startupInfo: STARTUPINFO,
    /,
) -> tuple[int, int, int, int]: ...


def ResumeThread(handle: int, /) -> int: ...
def TerminateProcess(handle: int, exitCode: int, /) -> None: ...
def GetExitCodeProcess(handle: int, /) -> int: ...
