# /// script
# requires-python = ">=3.12"
# dependencies = ["pywin32>=312; sys_platform == 'win32'"]
# ///
# How to run: invoked internally by OwnedProcess.spawn on Windows.

"""Wait for Job ownership before spawning the requested Windows command."""

from __future__ import annotations

import socket
import subprocess
import sys
from typing import Final

import os
import pywintypes
import win32api
import win32con
import win32event
import win32job
import win32process

BOOTSTRAP_FAILURE: Final = 125


def main(argv: list[str]) -> int:
    host = argv[1]
    port = int(argv[2])
    token = argv[3]
    job_name = argv[4]
    creationflags = int(argv[5])
    command = argv[6:]
    with socket.create_connection((host, port), timeout=10.0) as gate:
        job_handle = win32job.OpenJobObject(
            win32job.JOB_OBJECT_ASSIGN_PROCESS,
            False,
            job_name,
        )
        process_handle, thread_handle = _create_owned_suspended_process(
            job_handle,
            command,
            creationflags,
        )
        try:
            gate.sendall(f"{token}\n".encode())
            if gate.recv(1) != b"1":
                win32process.TerminateProcess(process_handle, BOOTSTRAP_FAILURE)
                return BOOTSTRAP_FAILURE
            _previous_suspend_count = win32process.ResumeThread(thread_handle)
            _ = win32event.WaitForSingleObject(process_handle, win32event.INFINITE)
            return int(win32process.GetExitCodeProcess(process_handle))
        finally:
            win32api.CloseHandle(thread_handle)
            win32api.CloseHandle(process_handle)


def _create_owned_suspended_process(
    job_handle: int,
    command: list[str],
    creationflags: int,
) -> tuple[int, int]:
    startup_info = win32process.STARTUPINFO()
    startup_info.dwFlags |= (
        win32con.STARTF_USESTDHANDLES | win32con.STARTF_USESHOWWINDOW
    )
    startup_info.wShowWindow = win32con.SW_HIDE
    standard_handles = (
        win32api.GetStdHandle(win32api.STD_INPUT_HANDLE),
        win32api.GetStdHandle(win32api.STD_OUTPUT_HANDLE),
        win32api.GetStdHandle(win32api.STD_ERROR_HANDLE),
    )
    startup_info.hStdInput = standard_handles[0]
    startup_info.hStdOutput = standard_handles[1]
    startup_info.hStdError = standard_handles[2]
    for handle in standard_handles:
        os.set_handle_inheritable(int(handle), True)
    created = win32process.CreateProcess(
        None,
        subprocess.list2cmdline(command),
        None,
        None,
        True,
        creationflags | win32con.CREATE_SUSPENDED | win32con.CREATE_NO_WINDOW,
        None,
        None,
        startup_info,
    )
    process_handle = created[0]
    thread_handle = created[1]
    try:
        try:
            win32job.AssignProcessToJobObject(job_handle, process_handle)
        finally:
            win32api.CloseHandle(job_handle)
    except pywintypes.error:
        win32process.TerminateProcess(process_handle, BOOTSTRAP_FAILURE)
        win32api.CloseHandle(thread_handle)
        win32api.CloseHandle(process_handle)
        raise
    return process_handle, thread_handle


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
