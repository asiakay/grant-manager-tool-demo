#!/usr/bin/env python3
"""Simple Tkinter interface for wrangle_grants.
Allows selecting input/output paths, adjusting weights, and running the
wrangler without command-line usage.
"""

import threading
import tkinter as tk
from tkinter import filedialog, messagebox

import wrangle_grants


# ----------------- UI callbacks -----------------

def run_wrangler():
    input_dir = input_var.get().strip()
    csv_out = csv_var.get().strip()
    xlsx_out = xlsx_var.get().strip()
    w1 = w1_var.get().strip() or "0.4"
    w2 = w2_var.get().strip() or "0.4"
    w3 = w3_var.get().strip() or "0.2"
    cutoff = cutoff_var.get().strip()

    argv = ["--input", input_dir, "--out", csv_out,
            "--weights", w1, w2, w3]
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
        except Exception as e:
            messagebox.showerror("Grant Wrangler", str(e))

    threading.Thread(target=task, daemon=True).start()


def browse_dir():
    d = filedialog.askdirectory()
    if d:
        input_var.set(d)


def browse_csv():
    f = filedialog.asksaveasfilename(defaultextension=".csv", filetypes=[("CSV", "*.csv")])
    if f:
        csv_var.set(f)


def browse_xlsx():
    f = filedialog.asksaveasfilename(defaultextension=".xlsx", filetypes=[("Excel", "*.xlsx")])
    if f:
        xlsx_var.set(f)


# ----------------- Build UI -----------------

root = tk.Tk()
root.title("Grant CSV Wrangler")

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
tk.Entry(root, textvariable=w1_var, width=5).grid(row=3, column=1, sticky="w")
tk.Entry(root, textvariable=w2_var, width=5).grid(row=3, column=2, sticky="w")
tk.Entry(root, textvariable=w3_var, width=5).grid(row=3, column=3, sticky="w")

# Row 4: cutoff
tk.Label(root, text="Deadline cutoff").grid(row=4, column=0, sticky="e")
tk.Entry(root, textvariable=cutoff_var, width=10).grid(row=4, column=1, sticky="w")

# Row 5: summary checkbox
tk.Checkbutton(root, text="Print summary", variable=summary_var).grid(row=5, column=1, sticky="w")

# Row 6: run button
tk.Button(root, text="Run", command=run_wrangler).grid(row=6, column=1, pady=10)

root.mainloop()
