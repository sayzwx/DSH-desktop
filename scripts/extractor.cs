// DSH Desktop bundle self-extractor: extracts the embedded zip to a temp
// dir and runs setup.bat (the one-click installer) from it.
using System;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Reflection;

class DshSetup {
  static int Main() {
    try {
      string tmp = Path.Combine(Path.GetTempPath(), "DSH-Install-" + Guid.NewGuid().ToString("N"));
      Directory.CreateDirectory(tmp);
      Console.WriteLine("Extracting installer bundle ...");
      using (Stream s = Assembly.GetExecutingAssembly().GetManifestResourceStream("DSH.bundle.zip")) {
        if (s == null) { Console.Error.WriteLine("bundle not found inside this executable"); return 2; }
        using (ZipArchive z = new ZipArchive(s, ZipArchiveMode.Read)) {
          z.ExtractToDirectory(tmp);
        }
      }
      Process p = Process.Start(new ProcessStartInfo("cmd.exe", "/c setup.bat") {
        WorkingDirectory = tmp,
        UseShellExecute = false
      });
      p.WaitForExit();
      try { Directory.Delete(tmp, true); } catch { }
      return p.ExitCode;
    } catch (Exception ex) {
      Console.Error.WriteLine(ex.ToString());
      Console.WriteLine("Press Enter to exit ...");
      Console.ReadLine();
      return 1;
    }
  }
}
