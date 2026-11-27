"""Use the container allocation, not the physical host's CPU count."""
import math
import os
from pathlib import Path


def available_cpus():
    count = os.cpu_count() or 1
    try: count = min(count, len(os.sched_getaffinity(0)))
    except (AttributeError, OSError): pass
    for quota_path, period_path in (
        ('/sys/fs/cgroup/cpu.max', None),
        ('/sys/fs/cgroup/cpu/cpu.cfs_quota_us', '/sys/fs/cgroup/cpu/cpu.cfs_period_us'),
    ):
        try:
            if period_path:
                quota, period = int(Path(quota_path).read_text()), int(Path(period_path).read_text())
            else:
                quota, period = Path(quota_path).read_text().split()
                if quota == 'max': continue
                quota, period = int(quota), int(period)
            if quota > 0 and period > 0: count = min(count, max(1, math.ceil(quota/period)))
        except (OSError, ValueError): pass
    return max(1,count)


def thread_budget():
    available = available_cpus()
    for key in ('RIFFSYNC_CPU_THREADS','OMP_NUM_THREADS','MKL_NUM_THREADS'):
        try:
            requested = int(os.environ.get(key,''))
            if requested > 0: return min(available,requested,32)
        except ValueError: pass
    return min(8,available)


def child_environment():
    env = dict(os.environ)
    budget = str(thread_budget())
    env.update(RIFFSYNC_CPU_THREADS=budget, OMP_NUM_THREADS=budget,
               MKL_NUM_THREADS=budget, OPENBLAS_NUM_THREADS=budget,
               TF_NUM_INTRAOP_THREADS=budget, TF_NUM_INTEROP_THREADS='1')
    env.setdefault('TF_CPP_MIN_LOG_LEVEL','2')
    return env


def configure_torch():
    import torch
    budget = thread_budget()
    torch.set_num_threads(budget)
    return budget


def summary():
    return {'cpus':available_cpus(),'threads':thread_budget()}
