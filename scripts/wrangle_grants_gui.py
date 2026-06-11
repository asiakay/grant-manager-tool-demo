#!/usr/bin/env python3
"""Simple Tkinter interface for ``wrangle_grants`` with basic authentication.

The original script allowed selecting input/output paths, adjusting weights
and running the wrangler without command-line usage.  This update adds a very
small login screen with two roles:

``admin``
    Has access to all fields including weight and deadline controls.
``user``
    Can run the wrangler but cannot modify weights or deadline cutoffs.

The credentials are intentionally hard-coded for demonstration purposes only
and **should not** be used in production settings.
"""

import threading
import tkinter as tk
from tkinter import filedialog, messagebox

import wrangle_grants

# ---------------------------------------------------------------------------
# Authentication configuration
# ---------------------------------------------------------------------------

# Simple in-memory user database for demo purposes.  A real application would
# look these up from a secure source.
USERS = {
    "admin": {"password": "adminpass", "role": "admin"},
    "user": {"password": "userpass", "role": "user"},
}


# Placeholders for Tk variables; these are initialised after login.
input_var = csv_var = xlsx_var = None
w1_var = w2_var = w3_var = cutoff_var = None
summary_var = None
root = tk.Tk()
root.title("Grant CSV Wrangler")


###############################################################################
# UI callbacks
###############################################################################


def run_wrangler():
    """Invoke ``wrangle_grants`` using values from the UI widgets."""

    input_dir = input_var.get().strip()
    csv_out = csv_var.get().strip()
    xlsx_out = xlsx_var.get().strip()
    w1 = w1_var.get().strip() or "0.4"
    w2 = w2_var.get().strip() or "0.4"
    w3 = w3_var.get().strip() or "0.2"
    cutoff = cutoff_var.get().strip()

    argv = ["--input", input_dir, "--out", csv_out, "--weights", w1, w2, w3]
    if xlsx_out:
        argv.extend(["--xlsx", xlsx_out])
    if cutoff:
        argv.extend(["--deadline-cutoff", cutoff])
    if summary_var.get():
        argv.append("--print-summary")

    def task():
        try:
            wrangle_grants.main(argv)
            messagebox.showinfo("Grant Wrangler", "Wrangling complete.")
        except SystemExit as e:  # pragma: no cover - surfaced from wrangler
            messagebox.showerror("Grant Wrangler", str(e))
        except Exception as e:  # pragma: no cover - unexpected errors
            messagebox.showerror("Grant Wrangler", str(e))

    threading.Thread(target=task, daemon=True).start()


def browse_dir():
    d = filedialog.askdirectory()
    if d:
        input_var.set(d)


def browse_csv():
    f = filedialog.asksaveasfilename(
        defaultextension=".csv", filetypes=[("CSV", "*.csv")]
    )
    if f:
        csv_var.set(f)


def browse_xlsx():
    f = filedialog.asksaveasfilename(
        defaultextension=".xlsx", filetypes=[("Excel", "*.xlsx")]
    )
    if f:
        xlsx_var.set(f)


###############################################################################
# Login and main UI construction
###############################################################################


def build_main_ui(role: str) -> None:
    """Construct the main wrangler interface.

    Parameters
    ----------
    role:
        The authenticated user role.  Non-admin users have several controls
        disabled for simplicity.
    """

    global input_var, csv_var, xlsx_var, w1_var, w2_var, w3_var, cutoff_var, summary_var

    # Initialise Tk variables used by callbacks
    input_var = tk.StringVar()
    csv_var = tk.StringVar()
    xlsx_var = tk.StringVar()
    w1_var = tk.StringVar(value="0.4")
    w2_var = tk.StringVar(value="0.4")
    w3_var = tk.StringVar(value="0.2")
    cutoff_var = tk.StringVar()
    summary_var = tk.BooleanVar(value=False)

    # Row 0: input folder
    tk.Label(root, text="Input folder").grid(row=0, column=0, sticky="e")
    tk.Entry(root, textvariable=input_var, width=40).grid(row=0, column=1)
    tk.Button(root, text="Browse", command=browse_dir).grid(row=0, column=2)

    # Row 1: output csv
    tk.Label(root, text="Output CSV").grid(row=1, column=0, sticky="e")
    tk.Entry(root, textvariable=csv_var, width=40).grid(row=1, column=1)
    tk.Button(root, text="Browse", command=browse_csv).grid(row=1, column=2)

    # Row 2: output xlsx
    tk.Label(root, text="Output XLSX").grid(row=2, column=0, sticky="e")
    tk.Entry(root, textvariable=xlsx_var, width=40).grid(row=2, column=1)
    tk.Button(root, text="Browse", command=browse_xlsx).grid(row=2, column=2)

    # Row 3: weights
    tk.Label(root, text="Weights (rel, fit, ease)").grid(row=3, column=0, sticky="e")
    w1_entry = tk.Entry(root, textvariable=w1_var, width=5)
    w1_entry.grid(row=3, column=1, sticky="w")
    w2_entry = tk.Entry(root, textvariable=w2_var, width=5)
    w2_entry.grid(row=3, column=2, sticky="w")
    w3_entry = tk.Entry(root, textvariable=w3_var, width=5)
    w3_entry.grid(row=3, column=3, sticky="w")

    # Row 4: cutoff
    tk.Label(root, text="Deadline cutoff").grid(row=4, column=0, sticky="e")
    cutoff_entry = tk.Entry(root, textvariable=cutoff_var, width=10)
    cutoff_entry.grid(row=4, column=1, sticky="w")

    # Row 5: summary checkbox
    tk.Checkbutton(root, text="Print summary", variable=summary_var).grid(
        row=5, column=1, sticky="w"
    )

    # Row 6: run button
    tk.Button(root, text="Run", command=run_wrangler).grid(row=6, column=1, pady=10)

    if role != "admin":
        for widget in (w1_entry, w2_entry, w3_entry, cutoff_entry):
            widget.configure(state="disabled")


def build_login_ui() -> None:
    """Show a login form and authenticate against ``USERS``."""

    login = tk.Frame(root, padx=10, pady=10)
    login.pack()

    tk.Label(login, text="Username").grid(row=0, column=0, sticky="e")
    username_var = tk.StringVar()
    tk.Entry(login, textvariable=username_var).grid(row=0, column=1)

    tk.Label(login, text="Password").grid(row=1, column=0, sticky="e")
    password_var = tk.StringVar()
    tk.Entry(login, textvariable=password_var, show="*").grid(row=1, column=1)

    def attempt_login():
        username = username_var.get().strip()
        password = password_var.get().strip()
        user = USERS.get(username)
        if user and user["password"] == password:
            login.destroy()
            build_main_ui(user["role"])
        else:
            messagebox.showerror("Grant Wrangler", "Invalid credentials")

    tk.Button(login, text="Login", command=attempt_login).grid(
        row=2, column=0, columnspan=2, pady=5
    )


if __name__ == "__main__":
    build_login_ui()
    root.mainloop()
