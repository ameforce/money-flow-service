from typing import Literal, TypedDict, overload


class BasicLimitInformation(TypedDict):
    LimitFlags: int


class ExtendedLimitInformation(TypedDict):
    BasicLimitInformation: BasicLimitInformation


class BasicAccountingInformation(TypedDict):
    ActiveProcesses: int


JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE: int
JOB_OBJECT_ASSIGN_PROCESS: int
JobObjectBasicAccountingInformation: Literal[1]
JobObjectExtendedLimitInformation: Literal[9]


def AssignProcessToJobObject(hJob: int, hProcess: int, /) -> None: ...
def CreateJobObject(jobAttributes: None, name: str, /) -> int: ...
def OpenJobObject(access: int, inheritHandle: bool, name: str, /) -> int: ...
def TerminateJobObject(hJob: int, exitCode: int, /) -> None: ...


@overload
def QueryInformationJobObject(
    Job: int,
    JobObjectInfoClass: Literal[1],
    /,
) -> BasicAccountingInformation: ...
@overload
def QueryInformationJobObject(
    Job: int,
    JobObjectInfoClass: Literal[9],
    /,
) -> ExtendedLimitInformation: ...


def SetInformationJobObject(
    Job: int,
    JobObjectInfoClass: Literal[9],
    JobObjectInfo: ExtendedLimitInformation,
    /,
) -> None: ...
