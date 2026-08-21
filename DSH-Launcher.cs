using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;

namespace DSHLauncher
{
    class Program
    {
        static void Main(string[] args)
        {
            try
            {
                // 1. 确定 DSH.exe 路径：优先已安装位置，其次便携版相对路径
                string exePath = FindDSHExe();
                if (exePath == null || !File.Exists(exePath))
                {
                    ShowError("找不到 DSH.exe。请先运行安装器，或将便携版解压到同目录。");
                    return;
                }

                // 2. 创建桌面快捷方式（如不存在）
                CreateDesktopShortcut(exePath);

                // 3. 启动 DSH.exe
                var psi = new ProcessStartInfo
                {
                    FileName = exePath,
                    WorkingDirectory = Path.GetDirectoryName(exePath),
                    UseShellExecute = true // 让系统处理 DPI/管理员提升等
                };
                Process.Start(psi);
            }
            catch (Exception ex)
            {
                ShowError("启动失败：" + ex.Message);
            }
        }

        static string FindDSHExe()
        {
            // 1) 已安装位置：%LOCALAPPDATA%\DSH\app\DSH.exe
            string localApp = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            string installed = Path.Combine(localApp, "DSH", "app", "DSH.exe");
            if (File.Exists(installed)) return installed;

            // 2) 便携版：启动器同目录下的 app\DSH.exe（便携版解压结构）
            string baseDir = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
            string portable = Path.Combine(baseDir, "app", "DSH.exe");
            if (File.Exists(portable)) return portable;

            // 3) 同目录直接有 DSH.exe（极简便携）
            string sameDir = Path.Combine(baseDir, "DSH.exe");
            if (File.Exists(sameDir)) return sameDir;

            return null;
        }

        static void CreateDesktopShortcut(string targetExe)
        {
            try
            {
                string desktop = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
                string shortcutPath = Path.Combine(desktop, "DSH.lnk");
                if (File.Exists(shortcutPath)) return; // 已存在

                // 用 COM 创建快捷方式
                Type shellType = Type.GetTypeFromProgID("WScript.Shell");
                dynamic shell = Activator.CreateInstance(shellType);
                dynamic shortcut = shell.CreateShortcut(shortcutPath);
                shortcut.TargetPath = targetExe;
                shortcut.WorkingDirectory = Path.GetDirectoryName(targetExe);
                shortcut.IconLocation = targetExe + ", 0";
                shortcut.Description = "DSH Desktop (DeepSeek Harness)";
                shortcut.Save();
            }
            catch { /* 忽略快捷方式创建失败，不影响主功能 */ }
        }

        static void ShowError(string msg)
        {
            MessageBox(IntPtr.Zero, msg, "DSH Launcher", 0x10); // MB_ICONERROR
        }

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        static extern int MessageBox(IntPtr hWnd, string text, string caption, uint type);
    }
}