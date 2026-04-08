# ENERGY REFORMULATION OF THE SPYROGRAPHER KINEMATIC MODEL
--> Segments get a spring stiffness component
--> Actuators (a.k.a rotating discs) get a torque component
--> Anchors are still fixed constraints 

## Local dev server

This project ships with a tiny local dev server that disables browser caching,
which helps avoid stale-file mismatches during normal refreshes.

For `cmd.exe`:

- Start in a separate terminal: `start_dev_server.cmd`
- Stop the server on port 8000: `stop_dev_server.cmd`
- Run in the current terminal: `python dev_server.py`
- Stop when running in the current terminal: `Ctrl+C`

Server URL: `http://localhost:8000/`

---

# Energy-Based Formulation of the System

## 1. Overview

The system is modeled as a set of points $( X_{i,k}(t) \in \mathbb{R}^2 )$ connected by elastic elements (springs) and subject to attachment constraints.

Instead of enforcing hard geometric constraints, the configuration at time ( t ) is obtained by minimizing a total energy:

$$
E_{\text{total}}(x,t)
$$

where $( x )$ is the vector of all unknown node positions.

---

## 2. Variables

* Nodes:
  $$
  X_{i,k}(t) \in \mathbb{R}^2
  $$

* Disc-driven attachment points:
  $$
  A_i(t) = c_i + r_i
  \begin{pmatrix}
  \cos(\theta_i(t)) \
  \sin(\theta_i(t))
  \end{pmatrix}
  $$

---

## 3. Segment (Spring) Energy

Each segment behaves like a linear spring with:

* rest length ( s_{i,k} )
* stiffness ( k_{i,k} > 0 )

Energy contribution:

$$
E_{i,k} = \frac{1}{2} k_{i,k} \left( |X_{i,k} - X_{i,k-1}| - s_{i,k} \right)^2
$$

---

## 4. Anchor Energy

An anchor connects a node ( X_{i,n_i} ) to a point on another segment.

Let:
$$
H(t) = X_{j,\ell-1}(t) + \lambda \left( X_{j,\ell}(t) - X_{j,\ell-1}(t) \right), \quad \lambda \in [0,1]
$$

Anchor energy:

$$
E_{\text{anchor}} = \frac{1}{2} k_a , |X_{i,n_i} - H(t)|^2
$$

where $( k_a )$ is the anchor stiffness.

---

## 5. Disc Attachment Energy (Optional)

If disc attachment is treated as a soft constraint:

$$
E_{\text{disc}} = \frac{1}{2} k_d , |X_{i,0} - A_i(t)|^2
$$

Otherwise, enforce:
$$
X_{i,0}(t) = A_i(t)
$$
as a hard constraint.

---

## 6. Total Energy

$$
E_{\text{total}}(x,t) =
\sum_{i,k} E_{i,k}
+
\sum_{\text{anchors}} E_{\text{anchor}}
+
\sum_i E_{\text{disc}}
$$

---

## 7. System Solution

At each time $( t )$, the configuration is obtained by solving:

$$
x^*(t) = \arg\min_x E_{\text{total}}(x,t)
$$

---

## 8. Dynamic Extension (Optional)

If masses ( m ) are introduced, the system evolves according to:

$$
m \ddot{x}(t) = - \nabla E_{\text{total}}(x,t)
$$

With damping:

$$
m \ddot{x}(t) + c \dot{x}(t) + \nabla E_{\text{total}}(x,t) = 0
$$

---

## 9. Notes

* As $( k_{i,k} \to \infty )$, segments behave as rigid constraints.
* Large $( k_a )$ enforces strong anchoring.
* The formulation guarantees existence of a solution (minimum energy), but not necessarily uniqueness.
* Numerical optimization methods (e.g. L-BFGS, Gauss-Newton) are typically used.

---



