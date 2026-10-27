param([Parameter(Mandatory = $true)][ValidateSet('Protect', 'Unprotect', 'VerifyPrivateDirectory')][string]$Mode)

# Binary stdin/stdout only. Windows protects the archive for the current user.
# This is local protection, not portable or off-machine disaster recovery.
$ErrorActionPreference = 'Stop'
try {
    if ($Mode -eq 'VerifyPrivateDirectory') {
        $privateDirectory = [IO.Path]::GetFullPath([IO.Path]::Combine($PSScriptRoot, '..', '.tools', 'private'))
        $directoryInfo = [IO.DirectoryInfo]::new($privateDirectory)
        if (-not $directoryInfo.Exists -or ($directoryInfo.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
            throw 'Invalid private directory.'
        }
        $privateAcl = $directoryInfo.GetAccessControl()
        $currentSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
        if (-not $privateAcl.AreAccessRulesProtected) { throw 'Inherited private-directory permissions.' }
        $rules = $privateAcl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])
        $userCanWrite = $false
        foreach ($rule in $rules) {
            if ($rule.AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow) { continue }
            if ($rule.IdentityReference.Value -notin @($currentSid, 'S-1-5-18')) { throw 'Private directory grants another identity access.' }
            if ($rule.IdentityReference.Value -eq $currentSid -and
                ($rule.FileSystemRights -band [Security.AccessControl.FileSystemRights]::FullControl) -eq [Security.AccessControl.FileSystemRights]::FullControl -and
                ($rule.InheritanceFlags -band [Security.AccessControl.InheritanceFlags]::ContainerInherit) -and
                ($rule.InheritanceFlags -band [Security.AccessControl.InheritanceFlags]::ObjectInherit)) { $userCanWrite = $true }
        }
        if (-not $userCanWrite) { throw 'Private-directory access is incomplete.' }
        [Console]::Out.Write('Private directory permissions verified.')
        exit 0
    }
    Add-Type -AssemblyName System.Security
    $inputBuffer = [IO.MemoryStream]::new()
    [Console]::OpenStandardInput().CopyTo($inputBuffer)
    $inputBytes = $inputBuffer.ToArray()
    $scope = [Security.Cryptography.DataProtectionScope]::CurrentUser
    if ($Mode -eq 'Protect') {
        $outputBytes = [Security.Cryptography.ProtectedData]::Protect($inputBytes, $null, $scope)
    } else {
        $outputBytes = [Security.Cryptography.ProtectedData]::Unprotect($inputBytes, $null, $scope)
    }
    [Console]::OpenStandardOutput().Write($outputBytes, 0, $outputBytes.Length)
    [Array]::Clear($inputBytes, 0, $inputBytes.Length)
    [Array]::Clear($outputBytes, 0, $outputBytes.Length)
    $inputBuffer.Dispose()
} catch {
    [Console]::Error.WriteLine('Windows backup protection failed; no archive contents logged.')
    exit 1
}
