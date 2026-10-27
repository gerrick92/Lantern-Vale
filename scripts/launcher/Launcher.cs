using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;

// Uses the Windows job lifetime to stop only processes started by this launcher.
// A previously running app is never assigned to the job or terminated.
internal static class Launcher
{
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr CreateJobObject(IntPtr attributes, string name);
    [DllImport("kernel32.dll")]
    private static extern bool SetInformationJobObject(IntPtr job, int type, IntPtr info, uint length);
    [DllImport("kernel32.dll")]
    private static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll")]
    private static extern bool CloseHandle(IntPtr handle);

    [StructLayout(LayoutKind.Sequential)]
    private struct BasicLimits
    {
        public long ProcessTime, JobTime;
        public uint Flags;
        public UIntPtr MinimumWorkingSet, MaximumWorkingSet;
        public uint ActiveProcesses;
        public UIntPtr Affinity;
        public uint Priority, Scheduling;
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct IoCounters { public ulong A, B, C, D, E, F; }
    [StructLayout(LayoutKind.Sequential)]
    private struct Limits
    {
        public BasicLimits Basic;
        public IoCounters Io;
        public UIntPtr ProcessMemory, JobMemory, PeakProcessMemory, PeakJobMemory;
    }
    private static string FindNode()
    {
        foreach (string folder in (Environment.GetEnvironmentVariable("PATH") ?? "").Split(';'))
        {
            if (String.IsNullOrWhiteSpace(folder)) continue;
            try {
                string file = Path.Combine(folder.Trim().Trim('"'), "node.exe");
                if (File.Exists(file)) return Path.GetFullPath(file);
            } catch (ArgumentException) { }
        }
        throw new Exception("Install Node.js 24 LTS and reopen this launcher.");
    }
    private static void OpenBrowser()
    {
        const string url = "http://127.0.0.1:3000";
        foreach (string variable in new string[] { "ProgramFiles(x86)", "ProgramFiles", "LOCALAPPDATA" }) {
            string folder = Environment.GetEnvironmentVariable(variable);
            if (String.IsNullOrEmpty(folder)) continue;
            string edge = Path.Combine(folder, "Microsoft", "Edge", "Application", "msedge.exe");
            if (File.Exists(edge)) { Process.Start(new ProcessStartInfo(edge, url) { UseShellExecute = true }); return; }
        }
        Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
    }
    private static int Main(string[] args)
    {
        IntPtr job = IntPtr.Zero;
        bool check = Array.IndexOf(args, "--check") >= 0;
        try
        {
            foreach (string arg in args)
                if (arg != "--check" && arg != "--no-browser") throw new Exception("Supported options: --check, --no-browser.");
            string root = AppDomain.CurrentDomain.BaseDirectory;
            string script = Path.Combine(root, "scripts", "launcher", "start.mjs");
            if (!File.Exists(script)) throw new Exception("Keep Lantern Vale.exe in the project root beside README.md.");
            job = CreateJobObject(IntPtr.Zero, null);
            if (job == IntPtr.Zero) throw new Exception("Could not create the local server process group.");
            Limits limits = new Limits();
            limits.Basic.Flags = 0x2000; // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
            int size = Marshal.SizeOf(typeof(Limits));
            IntPtr data = Marshal.AllocHGlobal(size);
            try {
                Marshal.StructureToPtr(limits, data, false);
                if (!SetInformationJobObject(job, 9, data, (uint)size)) throw new Exception("Could not configure safe server shutdown.");
            } finally { Marshal.FreeHGlobal(data); }
            ProcessStartInfo start = new ProcessStartInfo(FindNode(), "\"" + script + "\" " + String.Join(" ", args));
            start.WorkingDirectory = root;
            start.UseShellExecute = false;
            start.RedirectStandardOutput = true;
            // This is the user's interactive launcher console, not a background terminal.
            if (!Console.IsOutputRedirected) Console.Title = "Lantern Vale - Local server";
            Console.CancelKeyPress += delegate(object sender, ConsoleCancelEventArgs e) { e.Cancel = true; };
            using (Process process = Process.Start(start)) {
                if (!AssignProcessToJobObject(job, process.Handle)) {
                    if (!process.HasExited) process.Kill();
                    throw new Exception("Could not isolate the server process. Nothing else was stopped.");
                }
                bool opened = false;
                process.OutputDataReceived += delegate(object sender, DataReceivedEventArgs e) {
                    if (e.Data == null) return;
                    Console.WriteLine(e.Data);
                    // The browser belongs to the desktop, outside the server's job.
                    if (!opened && Array.IndexOf(args, "--no-browser") < 0 && e.Data.StartsWith("Ready: http://127.0.0.1:3000")) {
                        opened = true;
                        try { OpenBrowser(); } catch { Console.WriteLine("Open http://127.0.0.1:3000 in your browser."); }
                    }
                };
                process.BeginOutputReadLine();
                process.WaitForExit();
                if (process.ExitCode != 0) throw new Exception("Startup stopped. Follow the instructions above.");
            }
            return 0;
        }
        catch (Exception error)
        {
            if (job != IntPtr.Zero) { CloseHandle(job); job = IntPtr.Zero; }
            Console.Error.WriteLine(error.Message);
            if (!check && !Console.IsInputRedirected) {
                Console.WriteLine("Press Enter to close.");
                Console.ReadLine();
            }
            return 1;
        }
        finally { if (job != IntPtr.Zero) CloseHandle(job); }
    }
}
